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
        mailer.set_setting(db, "email_style", {})
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


def test_branded_design_button_and_logo(outbox):
    with _session() as db:
        subject, body, html = mailer.render(
            db, "activated", {"plan": "Pro", "name": "Sam", "tokens": "4,500", "end_date": "1 Jan", "app_url": "https://shop.example.test/app"}
        )
    # The link line became the button; the plain-text part still has it.
    assert 'href="https://shop.example.test/app"' in html and "Open workspace &rarr;" in html
    assert "https://shop.example.test/app" in body
    # Big number, kicker and headline from the design text.
    assert ">4,500<" in html and "Payment confirmed" in html and ">Your Pro plan is active<" in html
    assert 'src="https://shop.example.test/brand/blucloacking-mark-email.png"' in html


def test_admin_edits_design_and_style(outbox, admin):
    response = admin.put(
        "/api/v1/admin/emails",
        json={
            "templates": {"welcome": {"enabled": True, "subject": "", "body": "", "kicker": "", "stat": "Hey {name}", "button": "Go"}},
            "style": {
                "logo_url": "/api/v1/site-media/abc.png",
                "logo_size": 70,
                "header_color": "#111111",
                "header_text_color": "#ffffff",
                "page_color": "#eeeeee",
                "card_color": "#ffffff",
                "text_color": "#222222",
                "button_color": "#ff0000",
                "button_text_color": "#ffffff",
                "footer_text": "Bye <b>",
                "show_footer_logo": False,
            },
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["templates"]["welcome"]["kicker"] == ""  # blank hides it
    assert data["style"]["header_color"] == "#111111"
    email = address("mail-design")
    _signed_in(email)
    html = _mine(outbox, email)[0]["html"]
    assert "Account ready" not in html and "Hey there" in html and "Go &rarr;" in html
    assert "background:#111111" in html and "background:#ff0000" in html
    assert 'src="https://shop.example.test/api/v1/site-media/abc.png"' in html
    assert "Bye &lt;b&gt;" in html and "blucloacking-wordmark" not in html

    bad = {"templates": {}, "style": {**data["style"], "header_color": "red;x:y"}}
    assert admin.put("/api/v1/admin/emails", json=bad).status_code == 422
    bad = {"templates": {}, "style": {**data["style"], "logo_url": "javascript:alert(1)"}}
    assert admin.put("/api/v1/admin/emails", json=bad).status_code == 422


def test_admin_preview(outbox, admin):
    style = admin.get("/api/v1/admin/emails").json()["style_defaults"]
    response = admin.post(
        "/api/v1/admin/emails/preview",
        json={"kind": "ending", "template": {"subject": "Ends {end_date}", "body": "Hi\n\n{plan_url}", "days_before": 4}, "style": style},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["subject"].startswith("Ends ") and ">4 days<" in data["html"] and "Renew plan &rarr;" in data["html"]


def test_to_html_footer_param_for_group_sends():
    html = mailer.to_html("Hello\n\nhttps://a.example/x", footer='<a href="https://a.example/u">Unsubscribe</a>')
    assert '<a href="https://a.example/u">Unsubscribe</a>' in html
    assert '<a href="https://a.example/x"' in html  # no button label: link stays in the text
