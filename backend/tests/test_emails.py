"""Customer emails: welcome, plan activated, reminders, admin editor, SMTP."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import SecretStr

from app import mailer
from app.config import settings
from tests.test_volet import (  # noqa: F401 - fixtures
    _database,
    _reset_limiter,
    _activity,
    _load,
    _session,
    _signed_in,
    address,
    admin,
)


@pytest.fixture
def outbox(monkeypatch):
    """Email 'set up' through SMTP, with every message captured instead of sent."""

    sent: list[dict] = []
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "resend_api_key", None)
    monkeypatch.setattr(settings, "public_url", "https://shop.example.test")
    monkeypatch.setattr(mailer, "dispatch", lambda job: job())

    def fake(to, subject, html, text_body):
        sent.append({"to": to, "subject": subject, "html": html, "text": text_body})
        return True

    monkeypatch.setattr(mailer, "_send_smtp", fake)
    with _session() as db:
        mailer.set_setting(db, "email_templates", {})
        db.commit()
    yield sent
    with _session() as db:
        mailer.set_setting(db, "email_templates", {})
        db.commit()


def _mine(outbox, email):
    return [m for m in outbox if m["to"] == email]


def test_nothing_is_sent_without_a_mail_server(monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", "")
    monkeypatch.setattr(settings, "resend_api_key", None)
    called = []
    monkeypatch.setattr(mailer, "dispatch", lambda job: called.append(job))
    _signed_in(address("mail-off"))
    assert called == [] and mailer.transport() == ""


def test_welcome_email_once_per_account(outbox):
    email = address("mail-welcome")
    _signed_in(email)
    mine = _mine(outbox, email)
    assert len(mine) == 1
    assert mine[0]["subject"] == "Welcome to BluCloacking"
    assert "https://shop.example.test/app/plan" in mine[0]["text"]
    assert 'href="https://shop.example.test/app/plan"' in mine[0]["html"]
    assert any(d.startswith("Welcome sent") for d in _activity(email, "email"))

    # Calling it again for the same account does nothing.
    with _session() as db:
        assert mailer.welcome(db, _load(email)) is False
    assert len(_mine(outbox, email)) == 1


def test_plan_activated_email_on_admin_grant(outbox, admin):
    email = address("mail-activated")
    _signed_in(email)
    user_id = _load(email).id
    response = admin.post(f"/api/v1/admin/users/{user_id}/billing/grant", json={"plan_id": "pro", "months": 1})
    assert response.status_code in (200, 201), response.text
    mine = [m for m in _mine(outbox, email) if "active" in m["subject"]]
    assert len(mine) == 1
    assert mine[0]["subject"] == "Your Pro plan is active"
    assert "4,500 tokens" in mine[0]["text"]


def test_switched_off_and_edited_templates(outbox, admin):
    response = admin.put(
        "/api/v1/admin/emails",
        json={
            "templates": {
                "welcome": {"enabled": False, "subject": "", "body": ""},
                "activated": {"enabled": True, "subject": "{plan} is on, {name}!", "body": "Hello {name} {unknown}"},
                "ending": {"enabled": True, "subject": "", "body": "", "days_before": 5},
            }
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["templates"]["welcome"]["enabled"] is False
    assert data["templates"]["ending"]["days_before"] == 5
    # Blank text falls back to the default.
    assert data["templates"]["ending"]["subject"] == mailer.DEFAULT_TEMPLATES["ending"]["subject"]

    email = address("mail-edited")
    _signed_in(email)
    assert _mine(outbox, email) == []  # welcome is off

    with _session() as db:
        subject, body, _html = mailer.render(db, "activated", {"plan": "Pro", "name": "Sam"})
    assert subject == "Pro is on, Sam!"
    assert body == "Hello Sam {unknown}"  # unknown placeholders stay as typed

    assert admin.put("/api/v1/admin/emails", json={"templates": {"nope": {}}}).status_code == 422


def test_reminder_respects_switch_and_days_before(outbox):
    from tests.test_billing import _grant, _set_period_end

    email = address("mail-reminder")
    _signed_in(email)
    _grant(email, "starter")
    now = datetime.now(timezone.utc)
    _set_period_end(email, now + timedelta(days=5))
    with _session() as db:
        assert email not in {u.email for u, *_ in mailer.due_reminders(db, now)}  # default is 3 days
        mailer.set_setting(db, "email_templates", {"ending": {"enabled": True, "days_before": 6}})
        db.commit()
        assert email in {u.email for u, *_ in mailer.due_reminders(db, now)}
        mailer.set_setting(db, "email_templates", {"ending": {"enabled": False, "days_before": 6}})
        db.commit()
        assert email not in {u.email for u, *_ in mailer.due_reminders(db, now)}


def test_admin_test_email(outbox, admin, monkeypatch):
    response = admin.post("/api/v1/admin/emails/test", json={"kind": "ending"})
    assert response.status_code == 200, response.text
    assert outbox[-1]["subject"].startswith("[Test] Your Pro plan ends on ")
    assert admin.post("/api/v1/admin/emails/test", json={"kind": "bogus"}).status_code == 422

    monkeypatch.setattr(settings, "smtp_host", "")
    assert admin.post("/api/v1/admin/emails/test", json={"kind": "welcome"}).status_code == 409
    status = admin.get("/api/v1/admin/emails").json()
    assert status["transport"] == "" and set(status["templates"]) == set(mailer.KINDS)


def test_email_admin_routes_need_an_admin():
    client = _signed_in(address("mail-nobody"))
    assert client.get("/api/v1/admin/emails").status_code in (403, 404)


def test_smtp_message_is_built_and_sent(monkeypatch):
    calls: dict = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            calls["connect"] = (host, port)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def starttls(self, context=None):
            calls["tls"] = True

        def login(self, user, password):
            calls["login"] = (user, password)

        def send_message(self, message):
            calls["message"] = message

    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_security", "starttls")
    monkeypatch.setattr(settings, "smtp_username", "mailer")
    monkeypatch.setattr(settings, "smtp_password", SecretStr("placeholder"))
    monkeypatch.setattr(settings, "email_reply_to", "help@example.test")

    assert mailer.send_email("to@example.test", "Hi", "<p>Hello &amp; welcome</p>") is True
    message = calls["message"]
    assert calls["connect"] == ("smtp.example.test", 587) and calls["tls"]
    assert calls["login"] == ("mailer", "placeholder")
    assert message["To"] == "to@example.test" and message["Reply-To"] == "help@example.test"
    assert message.get_body(("plain",)).get_content().strip() == "Hello & welcome"

    def boom(*_a, **_k):
        raise OSError("no route")

    monkeypatch.setattr(mailer.smtplib, "SMTP", boom)
    assert mailer.send_email("to@example.test", "Hi", "<p>x</p>") is False


def test_html_escapes_customer_text():
    html = mailer.to_html("Hi <script>x</script>\n\nSee https://a.example/b")
    assert "<script>" not in html and "&lt;script&gt;" in html
    assert '<a href="https://a.example/b"' in html


def test_smtp_failures_explain_why():
    host, port = "smtp.example.test", 587
    auth = mailer.smtp_reason(mailer.smtplib.SMTPAuthenticationError(535, b"5.7.8 bad credentials"), host, port)
    assert "refused the login" in auth and "535" in auth
    sender = mailer.smtp_reason(mailer.smtplib.SMTPSenderRefused(550, b"sender not valid", "x@y"), host, port)
    assert "From address" in sender and "sender not valid" in sender
    blocked = mailer.smtp_reason(TimeoutError("timed out"), host, port)
    assert "Could not reach smtp.example.test:587" in blocked and "ADCAM_BREVO_API_KEY" in blocked
    data = mailer.smtp_reason(mailer.smtplib.SMTPDataError(554, b"rejected"), host, port)
    assert "refused the message" in data and "554 rejected" in data


def test_brevo_api_is_used_first_and_explains_errors(monkeypatch):
    calls: list[dict] = []

    class FakeResponse:
        def __init__(self, status, text=""):
            self.status_code, self.text = status, text

    replies = [FakeResponse(201, '{"messageId":"<1@x>"}')]

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append({"url": url, "headers": headers, "json": json})
        return replies.pop(0)

    monkeypatch.setattr(mailer.httpx, "post", fake_post)
    monkeypatch.setattr(settings, "brevo_api_key", SecretStr("placeholder"))
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(settings, "email_from", "Brand <billing@example.test>")
    monkeypatch.setattr(settings, "email_reply_to", "")
    assert mailer.transport() == "brevo"

    assert mailer.send_email_reason("to@example.test", "Hi", "<p>Hello</p>") is None
    sent = calls[0]
    assert sent["url"] == mailer.BREVO_URL and sent["headers"]["api-key"] == "placeholder"
    assert sent["json"]["sender"] == {"email": "billing@example.test", "name": "Brand"}
    assert sent["json"]["to"] == [{"email": "to@example.test"}] and sent["json"]["textContent"] == "Hello"

    replies.append(FakeResponse(401, '{"code":"unauthorized","message":"We have detected you are using an unrecognised IP address 1.2.3.4"}'))
    assert "Authorised IPs" in mailer.send_email_reason("to@example.test", "Hi", "<p>x</p>")
    replies.append(FakeResponse(401, '{"code":"unauthorized","message":"Key not found"}'))
    assert "API key" in mailer.send_email_reason("to@example.test", "Hi", "<p>x</p>")
    replies.append(FakeResponse(400, '{"code":"invalid_parameter","message":"Sender is not valid"}'))
    assert "Senders" in mailer.send_email_reason("to@example.test", "Hi", "<p>x</p>")
    replies.append(FakeResponse(500, "oops"))
    assert mailer.send_email("to@example.test", "Hi", "<p>x</p>") is False
