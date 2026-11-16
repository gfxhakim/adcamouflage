"""What a batch costs us on the hosting bill: worker time plus download bandwidth.

Each finished output writes one ``render_stats`` row with how long the worker
spent on it and how big the file is; each download adds the bytes sent. The
admin panel turns those into dollars with the hosting rates below, which the
owner can edit (Admin > Sales > Batch costs) when the provider changes its
prices. This only measures; nothing about rendering changes.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .app_settings import get_setting, set_setting
from .db import BatchRecord, RenderStat, User

logger = logging.getLogger(__name__)

SETTING = "cost_rates"
GB = 1024**3

# Railway usage prices and how hard one render works the box (see
# cost-analysis in the project notes). All editable from the panel.
DEFAULT_RATES: dict[str, float] = {
    "vcpu_per_minute": 0.000463,
    "gb_ram_per_minute": 0.000231,
    "egress_per_gb": 0.05,
    "vcpus_busy": 2.0,
    "ram_gb": 0.55,
}

# Typical figures for the estimate table, per minute of video at the heaviest
# settings: worker minutes and output size in GB.
ESTIMATE = {
    "1080p": {"render_minutes": 3.0, "output_gb": 0.10},
    "4K": {"render_minutes": 7.0, "output_gb": 0.30},
}
ESTIMATE_LENGTHS = (15, 30, 60, 180, 300)


def get_rates(db: Session) -> dict[str, float]:
    saved = get_setting(db, SETTING, {}) or {}
    rates = dict(DEFAULT_RATES)
    for key in rates:
        try:
            if key in saved:
                rates[key] = max(0.0, float(saved[key]))
        except (TypeError, ValueError):
            pass
    return rates


def save_rates(db: Session, rates: dict[str, float]) -> None:
    set_setting(db, SETTING, {key: float(rates[key]) for key in DEFAULT_RATES if key in rates})


def compute_cost(rates: dict[str, float], render_seconds: float) -> float:
    minutes = max(0.0, render_seconds) / 60
    return minutes * (rates["vcpus_busy"] * rates["vcpu_per_minute"] + rates["ram_gb"] * rates["gb_ram_per_minute"])


def egress_cost(rates: dict[str, float], sent_bytes: float) -> float:
    return max(0.0, sent_bytes) / GB * rates["egress_per_gb"]


def record_render(
    asset_id: str,
    batch_id: str,
    *,
    kind: str,
    render_seconds: float,
    output_bytes: int,
    resolution: str = "",
    duration: float = 0.0,
) -> None:
    """Called by the worker when an output is done. Opens its own session and never raises."""

    try:
        from .db import get_session_factory

        with get_session_factory()() as db:
            batch = db.get(BatchRecord, batch_id)
            row = db.get(RenderStat, asset_id)
            if row is None:
                row = RenderStat(asset_id=asset_id, batch_id=batch_id)
                db.add(row)
            row.user_id = batch.user_id if batch else None
            row.kind = kind
            row.render_seconds = float(render_seconds)
            row.output_bytes = int(output_bytes)
            row.resolution = str(resolution or "")[:24]
            row.duration_seconds = float(duration or 0.0)
            db.commit()
    except Exception:  # noqa: BLE001 - cost bookkeeping must never fail a render
        logger.warning("could not record render stats for %s", asset_id, exc_info=True)


def record_download(db: Session, asset_id: str, sent_bytes: int) -> None:
    try:
        row = db.get(RenderStat, asset_id)
        if row is not None:
            row.downloads += 1
            row.downloaded_bytes += int(sent_bytes)
            db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.warning("could not record download for %s", asset_id, exc_info=True)


def _line(rates: dict[str, float], render_seconds: float, output_bytes: int, downloaded_bytes: int) -> dict[str, float]:
    compute = compute_cost(rates, render_seconds)
    egress = egress_cost(rates, max(downloaded_bytes, output_bytes))
    return {"compute": round(compute, 4), "egress": round(egress, 4), "total": round(compute + egress, 4)}


def batch_costs(db: Session, days: int = 30, limit: int = 100) -> dict[str, Any]:
    """Recent batches with what each one cost, plus totals and the estimate table."""

    rates = get_rates(db)
    since = datetime.now(timezone.utc) - timedelta(days=days)
    stats = db.execute(
        select(RenderStat).where(RenderStat.created_at >= since).order_by(RenderStat.created_at.desc())
    ).scalars().all()
    by_batch: dict[str, dict[str, Any]] = {}
    for stat in stats:  # newest first, so batches come out newest first too
        entry = by_batch.setdefault(
            stat.batch_id,
            {"user_id": stat.user_id, "outputs": 0, "seconds": 0.0, "bytes": 0, "downloads": 0, "sent": 0,
             "duration": 0.0, "resolution": stat.resolution, "when": stat.created_at},
        )
        entry["outputs"] += 1
        entry["seconds"] += stat.render_seconds
        entry["bytes"] += stat.output_bytes
        entry["downloads"] += stat.downloads
        # Every output is counted as downloaded at least once, which is what
        # normally happens; extra downloads add their real bytes.
        entry["sent"] += max(stat.downloaded_bytes, stat.output_bytes)
        entry["duration"] = max(entry["duration"], stat.duration_seconds)
    grouped = [
        (batch_id, e["user_id"], e["outputs"], e["seconds"], e["bytes"], e["downloads"], e["sent"], e["duration"], e["resolution"], e["when"])
        for batch_id, e in by_batch.items()
    ]

    emails: dict[int, str] = {}
    user_ids = {row[1] for row in grouped if row[1] is not None}
    if user_ids:
        emails = dict(db.execute(select(User.id, User.email).where(User.id.in_(user_ids))).all())

    batches: list[dict[str, Any]] = []
    totals = {"batches": 0, "outputs": 0, "compute": 0.0, "egress": 0.0, "total": 0.0}
    for batch_id, user_id, outputs, seconds, out_bytes, downloads, sent, duration, resolution, when in grouped:
        cost = _line(rates, float(seconds or 0), int(out_bytes or 0), int(sent or 0))
        totals["batches"] += 1
        totals["outputs"] += int(outputs)
        for key in ("compute", "egress", "total"):
            totals[key] += cost[key]
        if len(batches) < limit:
            batches.append(
                {
                    "batch_id": batch_id,
                    "user_id": user_id,
                    "email": emails.get(user_id, ""),
                    "outputs": int(outputs),
                    "resolution": resolution or "",
                    "duration_seconds": float(duration or 0),
                    "render_seconds": round(float(seconds or 0), 1),
                    "output_mb": round(int(out_bytes or 0) / 1024**2, 1),
                    "downloads": int(downloads or 0),
                    "created_at": when,
                    **cost,
                }
            )
    for key in ("compute", "egress", "total"):
        totals[key] = round(totals[key], 4)
    totals["average"] = round(totals["total"] / totals["batches"], 4) if totals["batches"] else 0.0
    return {"days": days, "rates": rates, "totals": totals, "batches": batches, "estimate": estimate_table(rates)}


def estimate_table(rates: dict[str, float], outputs: int = 5) -> list[dict[str, Any]]:
    """Expected cost of a batch of ``outputs`` generations by video length, heaviest settings, one download each."""

    table = []
    for seconds in ESTIMATE_LENGTHS:
        row: dict[str, Any] = {"seconds": seconds}
        for name, figures in ESTIMATE.items():
            minutes = seconds / 60
            one = compute_cost(rates, figures["render_minutes"] * minutes * 60) + egress_cost(
                rates, figures["output_gb"] * minutes * GB
            )
            row[name] = round(one * outputs, 3)
        table.append(row)
    return table
