"""Group emails: groups, preview, confirm, throttled sending, no double sends, unsubscribe."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import broadcast, mailer
from app.config import settings
from app.db import AdminAudit, EmailRecipient
from app.main import app
from tests.test_volet import (  # noqa: F401 - fixtures
    _database,
    _grant,
    _load,
    _reset_limiter,
    _session,
    _signed_in,
    _with_user,
    address,
    admin,
)

MSG = {"subject": "Hello {name}", "body": "Hi {name}, you are on {plan}.\n\nSee {plan_url}"}


@pytest.fixture
def outbox(monkeypatch):
    sent: list[dict] = []
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "resend_api_key", None)
    monkeypatch.setattr(settings, "public_url", "https://shop.example.test")
    monkeypatch.setattr(mailer, "dispatch", lambda job: None)  # no welcome mail noise
    monkeypatch.setattr(broadcast, "kick", lambda: None)

    def fake(to, subject, html, text_body, headers=None):
        sent.append({"to": to, "subject": subject, "html": html, "text": text_body, "headers": headers or {}})
        return True

    monkeypatch.setattr(mailer, "_send_smtp", fake)
    with _session() as db:
        broadcast.set_setting(db, broadcast.RULES_SETTING, {"daily_limit": 1000, "seconds_between": 0})
        db.commit()
    yield sent


def _run(**kwargs):
    with _session() as db:
        return broadcast.process(db, sleep=lambda s: None, **kwargs)


def _person(status, email):
    return next(p for p in status["people"] if p["email"] == email)


def test_groups_and_people(outbox, admin):
    fresh = address("grp-new")
    payer = address("grp-pro")
    _signed_in(fresh)
    _signed_in(payer)
    _grant(payer, "pro")

    status = admin.get("/api/v1/admin/emails/groups").json()
    ids = {g["id"] for g in status["groups"]}
    assert {"all", "new_7d", "never_paid", "active", "plan:pro", "expired", "low_tokens", "unsubscribed"} <= ids
    assert "never_paid" in _person(status, fresh)["groups"]
    assert "new_7d" in _person(status, fresh)["groups"]
    pro = _person(status, payer)
    assert "plan:pro" in pro["groups"] and "active" in pro["groups"] and "never_paid" not in pro["groups"]
    assert "no_renders" in pro["groups"]
    # Admins are never in the list.
    assert all(p["email"] != address("boss") for p in status["people"])
    assert status["drafts"] and status["rules"]["daily_limit"] == 1000


def test_expired_group(outbox, admin):
    email = address("grp-ended")
    _signed_in(email)
    _grant(email, "starter")
    _with_user(email, lambda db, u: setattr(u, "sub_period_end", datetime.now(timezone.utc) - timedelta(days=2)))
    groups = _person(admin.get("/api/v1/admin/emails/groups").json(), email)["groups"]
    assert "expired" in groups and "active" not in groups and "grace" in groups


def test_customers_cannot_use_it():
    client = _signed_in(address("grp-nosy"))
    assert client.get("/api/v1/admin/emails/groups").status_code == 404


def test_send_needs_confirm_word(outbox, admin):
    uid = _load(_signed_in_email("grp-confirm")).id
    r = admin.post("/api/v1/admin/emails/groups/send", json={**MSG, "user_ids": [uid], "confirm": "yes"})
    assert r.status_code == 422


def _signed_in_email(name):
    email = address(name)
    _signed_in(email)
    return email


def test_send_personalised_with_unsubscribe(outbox, admin):
    a = _signed_in_email("grp-a")
    b = _signed_in_email("grp-b")
    _grant(b, "max")
    ids = [_load(a).id, _load(b).id, _load(b).id]  # duplicate id is ignored
    r = admin.post(
        "/api/v1/admin/emails/groups/send", json={**MSG, "user_ids": ids, "audience": "test", "confirm": "SEND"}
    )
    assert r.status_code == 201, r.text
    campaign = r.json()["campaign"]
    assert campaign["total"] == 2 and campaign["pending"] == 2

    assert _run() == {"sent": 2, "failed": 0, "skipped": 0}
    mine = {m["to"]: m for m in outbox}
    assert mine[b]["subject"] == "Hello there"
    assert "you are on Max" in mine[b]["text"]
    assert "https://shop.example.test/unsubscribe?t=" in mine[a]["html"]
    assert mine[a]["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert mine[a]["headers"]["List-Unsubscribe"].startswith("<https://shop.example.test/api/v1/emails/unsubscribe?t=")

    # Running again sends nothing more.
    assert _run() == {"sent": 0, "failed": 0, "skipped": 0}
    detail = admin.get(f"/api/v1/admin/emails/groups/{campaign['id']}").json()
    assert detail["campaign"]["status"] == "done" and detail["campaign"]["sent"] == 2
    with _session() as db:
        assert db.query(AdminAudit).filter(AdminAudit.action == "group_email").count() >= 1


def test_daily_cap_spreads_sends(outbox, admin):
    with _session() as db:
        already = broadcast.sent_today(db)
    with _session() as db:
        broadcast.set_setting(db, broadcast.RULES_SETTING, {"daily_limit": already + 1, "seconds_between": 0})
        db.commit()
    ids = [_load(_signed_in_email(f"grp-cap{i}")).id for i in range(3)]
    admin.post("/api/v1/admin/emails/groups/send", json={**MSG, "user_ids": ids, "confirm": "SEND"})
    assert _run()["sent"] == 1
    assert _run()["sent"] == 0  # cap reached for today
    tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
    with _session() as db:
        broadcast.set_setting(db, broadcast.RULES_SETTING, {"daily_limit": 1000, "seconds_between": 0})
        db.commit()
    assert _run(now=lambda: tomorrow)["sent"] == 2


def test_unsubscribe_link_and_skip(outbox, admin):
    email = _signed_in_email("grp-unsub")
    user_id = _load(email).id
    token = broadcast.unsubscribe_token(user_id)
    public = TestClient(app)
    assert public.get("/api/v1/emails/unsubscribe", params={"t": token + "x"}).status_code == 404
    assert public.get("/api/v1/emails/unsubscribe", params={"t": token}).json()["unsubscribed"] is False
    # One-click unsubscribe, as Gmail sends it.
    r = public.post(f"/api/v1/emails/unsubscribe?t={token}", data={"List-Unsubscribe": "One-Click"})
    assert r.status_code == 200 and r.json()["unsubscribed"] is True

    other = _load(_signed_in_email("grp-still")).id
    r = admin.post("/api/v1/admin/emails/groups/send", json={**MSG, "user_ids": [user_id, other], "confirm": "SEND"})
    assert r.json()["campaign"]["total"] == 1 and r.json()["left_out_unsubscribed"] == 1
    _run()
    assert not [m for m in outbox if m["to"] == email]

    # Only unsubscribed people picked: refused.
    r = admin.post("/api/v1/admin/emails/groups/send", json={**MSG, "user_ids": [user_id], "confirm": "SEND"})
    assert r.status_code == 422
    assert public.post(f"/api/v1/emails/resubscribe?t={token}").json()["unsubscribed"] is False


def test_unsubscribed_after_queueing_is_skipped(outbox, admin):
    email = _signed_in_email("grp-late")
    uid = _load(email).id
    admin.post("/api/v1/admin/emails/groups/send", json={**MSG, "user_ids": [uid], "confirm": "SEND"})
    TestClient(app).post(f"/api/v1/emails/unsubscribe?t={broadcast.unsubscribe_token(uid)}")
    assert _run()["skipped"] == 1


def test_interrupted_send_is_not_repeated(outbox, admin):
    uid = _load(_signed_in_email("grp-crash")).id
    cid = admin.post("/api/v1/admin/emails/groups/send", json={**MSG, "user_ids": [uid], "confirm": "SEND"}).json()[
        "campaign"
    ]["id"]
    with _session() as db:
        row = db.query(EmailRecipient).filter(EmailRecipient.campaign_id == cid).one()
        row.status = "sending"  # what a restart mid-send leaves behind
        db.commit()
    assert _run()["sent"] == 0
    detail = admin.get(f"/api/v1/admin/emails/groups/{cid}").json()
    assert detail["recipients"][0]["status"] == "failed" and detail["campaign"]["status"] == "done"
    # Retry does not re-queue an interrupted one.
    assert admin.post(f"/api/v1/admin/emails/groups/{cid}/retry").json()["pending"] == 0


def test_failed_then_retry_and_stop(outbox, admin, monkeypatch):
    uids = [_load(_signed_in_email(f"grp-fail{i}")).id for i in range(2)]
    monkeypatch.setattr(mailer, "_send_smtp", lambda *a, **k: False)
    cid = admin.post("/api/v1/admin/emails/groups/send", json={**MSG, "user_ids": uids, "confirm": "SEND"}).json()[
        "campaign"
    ]["id"]
    assert _run()["failed"] == 2
    assert admin.post(f"/api/v1/admin/emails/groups/{cid}/retry").json()["pending"] == 2
    stopped = admin.post(f"/api/v1/admin/emails/groups/{cid}/cancel").json()
    assert stopped["status"] == "cancelled" and stopped["pending"] == 0
    assert _run()["failed"] == 0


def test_preview_and_test_send(outbox, admin):
    r = admin.post("/api/v1/admin/emails/groups/preview", json=MSG)
    assert r.status_code == 200 and "Unsubscribe" in r.json()["html"]
    r = admin.post("/api/v1/admin/emails/groups/test", json=MSG)
    assert r.status_code == 200
    assert outbox[-1]["subject"].startswith("[Test] Hello")


def test_send_requires_public_url(outbox, admin, monkeypatch):
    monkeypatch.setattr(settings, "public_url", "")
    uid = _load(_signed_in_email("grp-nourl")).id
    r = admin.post("/api/v1/admin/emails/groups/send", json={**MSG, "user_ids": [uid], "confirm": "SEND"})
    assert r.status_code == 409


def test_rules_saved(outbox, admin):
    r = admin.put("/api/v1/admin/emails/groups/rules", json={"daily_limit": 280, "seconds_between": 5})
    assert r.json()["rules"] == {"daily_limit": 280, "seconds_between": 5}
