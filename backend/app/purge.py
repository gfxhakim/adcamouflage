"""Delete every customer account at once, keeping the admins.

Used by the admin panel (Settings > Danger zone) and by the command line:

    python -m app.purge                       # dry run: only shows the counts
    python -m app.purge --yes                 # really deletes
    python -m app.purge --yes --keep a@b.com  # also keep this account

An account is kept when it is an admin (the ``is_admin`` flag or listed in
``ADCAM_ADMIN_EMAILS``) or its email is passed in ``keep``. Everything that
belongs to a deleted account goes with it: batches, token ledger, orders,
activity, support chats and team seats. This cannot be undone.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import asdict, dataclass, field
from typing import Iterable

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from .config import settings
from .db import (
    ActivityEvent,
    BatchRecord,
    Order,
    SupportMessage,
    SupportThread,
    TeamMember,
    TokenLedger,
    User,
)

CONFIRM_PHRASE = "DELETE ALL USERS"


@dataclass
class PurgeSummary:
    users: int = 0
    batches: int = 0
    orders: int = 0
    token_entries: int = 0
    activity: int = 0
    support_threads: int = 0
    team_seats: int = 0
    kept: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def _keep_set(keep: Iterable[str]) -> set[str]:
    emails = {e.strip().lower() for e in keep if e and e.strip()}
    emails.update(e.strip().lower() for e in (settings.admin_emails or []) if e)
    return emails


def _kept_filter(keep_emails: set[str]):
    # Never match an empty list: `IN ()` is fine in SQLAlchemy, but keep it explicit.
    return or_(User.is_admin.is_(True), User.email.in_(keep_emails or {""}))


def _targets(db: Session, keep_emails: set[str]) -> tuple[list[int], list[str]]:
    rows = db.execute(select(User.id, User.email).where(~_kept_filter(keep_emails))).all()
    return [r.id for r in rows], [r.email for r in rows]


def _count(db: Session, model, column, ids: list[int]) -> int:
    if not ids:
        return 0
    return int(db.scalar(select(func.count()).select_from(model).where(column.in_(ids))) or 0)


def preview(db: Session, keep: Iterable[str] = ()) -> PurgeSummary:
    """Counts of what a purge would delete, without changing anything."""

    keep_emails = _keep_set(keep)
    ids, emails = _targets(db, keep_emails)
    kept = db.scalars(select(User.email).where(_kept_filter(keep_emails)).order_by(User.email)).all()
    seat_filter = or_(TeamMember.owner_id.in_(ids or [-1]), TeamMember.email.in_(emails or [""]))
    return PurgeSummary(
        users=len(ids),
        batches=_count(db, BatchRecord, BatchRecord.user_id, ids),
        orders=_count(db, Order, Order.user_id, ids),
        token_entries=_count(db, TokenLedger, TokenLedger.user_id, ids),
        activity=_count(db, ActivityEvent, ActivityEvent.user_id, ids),
        support_threads=_count(db, SupportThread, SupportThread.user_id, ids),
        team_seats=int(db.scalar(select(func.count()).select_from(TeamMember).where(seat_filter)) or 0)
        if ids
        else 0,
        kept=list(kept),
    )


def purge(db: Session, keep: Iterable[str] = ()) -> PurgeSummary:
    """Delete every non-admin account and its data in one transaction.

    Child rows are deleted explicitly rather than trusting ON DELETE CASCADE,
    so it works the same on any database, however its tables were created.
    """

    keep_emails = _keep_set(keep)
    summary = preview(db, keep_emails)
    ids, emails = _targets(db, keep_emails)
    if not ids:
        return summary
    try:
        thread_ids = select(SupportThread.id).where(SupportThread.user_id.in_(ids))
        db.execute(delete(SupportMessage).where(SupportMessage.thread_id.in_(thread_ids)))
        db.execute(delete(SupportThread).where(SupportThread.user_id.in_(ids)))
        db.execute(delete(TeamMember).where(or_(TeamMember.owner_id.in_(ids), TeamMember.email.in_(emails))))
        for model in (TokenLedger, Order, ActivityEvent, BatchRecord):
            db.execute(delete(model).where(model.user_id.in_(ids)))
        db.execute(delete(User).where(User.id.in_(ids)))
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.expire_all()
    return summary


def _print(summary: PurgeSummary, done: bool) -> None:
    verb = "Deleted" if done else "Would delete"
    print(f"{verb} {summary.users} user account(s)")
    print(
        f"  with {summary.batches} batches, {summary.orders} orders, {summary.token_entries} token entries,"
        f" {summary.activity} activity rows, {summary.support_threads} support chats, {summary.team_seats} team seats"
    )
    print("Kept: " + (", ".join(summary.kept) or "(no admin accounts found!)"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Delete every non-admin account (irreversible).")
    parser.add_argument("--keep", action="append", default=[], help="extra email to keep (repeatable)")
    parser.add_argument("--yes", action="store_true", help="really delete; without it this is a dry run")
    args = parser.parse_args(argv)

    from .db import get_session_factory, init_db

    init_db()
    with get_session_factory()() as db:
        summary = preview(db, args.keep)
        if not summary.kept:
            print("Refusing: no admin account would be kept. Pass --keep your@email.", file=sys.stderr)
            return 2
        if not args.yes:
            _print(summary, done=False)
            print("Dry run only. Add --yes to really delete. This cannot be undone.")
            return 0
        _print(purge(db, args.keep), done=True)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
