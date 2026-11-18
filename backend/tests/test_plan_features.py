"""Per-plan feature gates: Starter cannot use the full engine group or the metadata wipe."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.plan_features import FEATURE_FIELDS

from .test_billing import _clear_setting, _database, _grant, _reset_limiter, _signed_in, address, admin  # noqa: F401

GEN4 = FEATURE_FIELDS["full_engine"]
ALL_ON = {field: True for field in (*GEN4, "strip_metadata")}


def _render(client: TestClient, image, options: dict):
    files = [("files", ("a.jpg", image.read_bytes(), "image/jpeg"))]
    return client.post("/api/v1/batches", files=files, data={"options": json.dumps(options)})


def test_plan_cards_carry_their_features():
    plans = {p["id"]: p for p in TestClient(app).get("/api/v1/plans").json()["plans"]}
    assert plans["starter"]["features"] == {"full_engine": False, "metadata_wipe": True, "multi_platform": False}
    assert plans["pro"]["features"] == {"full_engine": True, "metadata_wipe": True, "multi_platform": True}
    assert plans["max"]["features"] == {"full_engine": True, "metadata_wipe": True, "multi_platform": True}


def test_starter_render_api_switches_the_locked_options_off(sample_image):
    email = address("starter-locks")
    client = _signed_in(email)
    _grant(email, "starter")

    assert sorted(client.get("/api/v1/auth/subscription").json()["locked_features"]) == [
        "full_engine",
        "multi_platform",
    ]

    # Called directly with everything on, custom profile (default platform=meta).
    response = _render(client, sample_image, {"preset": "custom", **ALL_ON})
    assert response.status_code == 202, response.text
    options = response.json()["options"]
    assert options["platform"] == "meta"
    assert not any(options[field] for field in GEN4)
    assert options["strip_metadata"] is True
    # Untouched classic layers keep the caller's choice.
    assert options["micro_crop"] is True

    # A preset that turns Gen-4 layers on is clamped too, while keeping clean container export.
    stealth = _render(client, sample_image, {"preset": "stealth"}).json()["options"]
    assert not any(stealth[field] for field in GEN4) and stealth["strip_metadata"] is True

    # Starter cannot use TikTok or YouTube directly on the API — only Meta.
    for blocked_platform in ("tiktok", "youtube"):
        blocked = _render(client, sample_image, {"preset": "balanced", "platform": blocked_platform})
        assert blocked.status_code == 403, f"{blocked_platform} should be rejected on Starter: {blocked.text}"
        assert "Meta" in blocked.json()["detail"]

    meta_ok = _render(client, sample_image, {"preset": "balanced", "platform": "meta"})
    assert meta_ok.status_code == 202
    assert meta_ok.json()["options"]["platform"] == "meta"


@pytest.mark.parametrize("plan_id", ["pro", "max"])
def test_pro_and_max_keep_every_option(sample_image, plan_id):
    email = address(f"{plan_id}-unlocked")
    client = _signed_in(email)
    _grant(email, plan_id)

    assert client.get("/api/v1/auth/subscription").json()["locked_features"] == []
    options = _render(client, sample_image, {"preset": "custom", **ALL_ON}).json()["options"]
    assert all(options[field] for field in ALL_ON)
    for plat in ("meta", "tiktok", "youtube"):
        res = _render(client, sample_image, {"preset": "balanced", "platform": plat})
        assert res.status_code == 202
        assert res.json()["options"]["platform"] == plat


def test_admin_can_unlock_starter(admin, sample_image):
    config = admin.get("/api/v1/admin/billing/config").json()
    keep = ("label", "price", "tokens", "tokens_per_generation", "rollover_months", "topup_rate")
    starter = {k: config["plans"]["starter"][k] for k in keep}
    try:
        bad = admin.put("/api/v1/admin/billing/config", json={"plans": {"starter": {**starter, "features": {"teleport": True}}}})
        assert bad.status_code == 422

        saved = admin.put(
            "/api/v1/admin/billing/config",
            json={"plans": {"starter": {**starter, "features": {"full_engine": False, "metadata_wipe": True, "multi_platform": True}}}},
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["plans"]["starter"]["features"] == {
            "full_engine": False,
            "metadata_wipe": True,
            "multi_platform": True,
        }

        email = address("starter-partly-unlocked")
        client = _signed_in(email)
        _grant(email, "starter")
        assert client.get("/api/v1/auth/subscription").json()["locked_features"] == ["full_engine"]
        options = _render(client, sample_image, {"preset": "custom", "platform": "tiktok", **ALL_ON}).json()["options"]
        assert options["strip_metadata"] is True
        assert options["platform"] == "tiktok"
        assert not any(options[field] for field in GEN4)

        # Saving a plan without "features" keeps what is stored.
        admin.put("/api/v1/admin/billing/config", json={"plans": {"starter": starter}})
        stored = admin.get("/api/v1/admin/billing/config").json()["plans"]["starter"]["features"]
        assert stored["metadata_wipe"] is True
        assert stored["multi_platform"] is True
    finally:
        _clear_setting("token_plans")


def test_one_time_starter_metadata_wipe_backfill():
    from app.app_settings import set_setting
    from app.db import get_session_factory
    from app.tokens import ensure_starter_metadata_wipe, get_token_plans

    try:
        with get_session_factory()() as db:
            set_setting(
                db,
                "token_plans",
                {"starter": {"features": {"full_engine": False, "metadata_wipe": False}}},
            )
            set_setting(db, "migration.starter_metadata_wipe_v1", False)
            db.commit()
            ensure_starter_metadata_wipe(db)
            assert get_token_plans(db)["starter"].metadata_wipe is True

            # Subsequent admin opt-out stays respected once migration marker is set.
            set_setting(
                db,
                "token_plans",
                {"starter": {"features": {"full_engine": False, "metadata_wipe": False}}},
            )
            db.commit()
            ensure_starter_metadata_wipe(db)
            assert get_token_plans(db)["starter"].metadata_wipe is False
    finally:
        _clear_setting("token_plans")
        _clear_setting("migration.starter_metadata_wipe_v1")
