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
    assert plans["starter"]["features"] == {"full_engine": False, "metadata_wipe": False}
    assert plans["pro"]["features"] == {"full_engine": True, "metadata_wipe": True}
    assert plans["max"]["features"] == {"full_engine": True, "metadata_wipe": True}


def test_starter_render_api_switches_the_locked_options_off(sample_image):
    email = address("starter-locks")
    client = _signed_in(email)
    _grant(email, "starter")

    assert sorted(client.get("/api/v1/auth/subscription").json()["locked_features"]) == ["full_engine", "metadata_wipe"]

    # Called directly with everything on, custom profile.
    response = _render(client, sample_image, {"preset": "custom", **ALL_ON})
    assert response.status_code == 202, response.text
    options = response.json()["options"]
    assert not any(options[field] for field in GEN4)
    assert options["strip_metadata"] is False
    # Untouched classic layers keep the caller's choice.
    assert options["micro_crop"] is True

    # A preset that turns Gen-4 layers on is clamped too.
    stealth = _render(client, sample_image, {"preset": "stealth"}).json()["options"]
    assert not any(stealth[field] for field in GEN4) and stealth["strip_metadata"] is False


@pytest.mark.parametrize("plan_id", ["pro", "max"])
def test_pro_and_max_keep_every_option(sample_image, plan_id):
    email = address(f"{plan_id}-unlocked")
    client = _signed_in(email)
    _grant(email, plan_id)

    assert client.get("/api/v1/auth/subscription").json()["locked_features"] == []
    options = _render(client, sample_image, {"preset": "custom", **ALL_ON}).json()["options"]
    assert all(options[field] for field in ALL_ON)


def test_admin_can_unlock_starter(admin, sample_image):
    config = admin.get("/api/v1/admin/billing/config").json()
    keep = ("label", "price", "tokens", "tokens_per_generation", "rollover_months", "topup_rate")
    starter = {k: config["plans"]["starter"][k] for k in keep}
    try:
        bad = admin.put("/api/v1/admin/billing/config", json={"plans": {"starter": {**starter, "features": {"teleport": True}}}})
        assert bad.status_code == 422

        saved = admin.put(
            "/api/v1/admin/billing/config",
            json={"plans": {"starter": {**starter, "features": {"full_engine": False, "metadata_wipe": True}}}},
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["plans"]["starter"]["features"] == {"full_engine": False, "metadata_wipe": True}

        email = address("starter-partly-unlocked")
        client = _signed_in(email)
        _grant(email, "starter")
        assert client.get("/api/v1/auth/subscription").json()["locked_features"] == ["full_engine"]
        options = _render(client, sample_image, {"preset": "custom", **ALL_ON}).json()["options"]
        assert options["strip_metadata"] is True
        assert not any(options[field] for field in GEN4)

        # Saving a plan without "features" keeps what is stored.
        admin.put("/api/v1/admin/billing/config", json={"plans": {"starter": starter}})
        assert admin.get("/api/v1/admin/billing/config").json()["plans"]["starter"]["features"]["metadata_wipe"] is True
    finally:
        _clear_setting("token_plans")
