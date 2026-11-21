"""Runtime configuration for the ProteusFlow backend.

Every value can be overridden through environment variables (or a local
``.env`` file) so the same image runs unchanged in dev, staging and prod.
"""

from __future__ import annotations

import os
import secrets
from functools import lru_cache
from pathlib import Path

from typing import Annotated

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        env_prefix="ADCAM_",
        extra="ignore",
    )

    # --- service identity -------------------------------------------------
    app_name: str = "ProteusFlow"
    environment: str = "development"
    debug: bool = False

    # --- storage ----------------------------------------------------------
    storage_root: Path = Field(default=Path("/tmp/adcamouflage"))
    retention_hours: int = 24
    max_upload_mb: int = 2048
    max_batch_files: int = 25

    # --- redis / celery ---------------------------------------------------
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str | None = None
    celery_result_backend: str | None = None

    # When true the API executes mutation jobs on a local thread pool instead
    # of handing them to Celery. Useful for laptops, CI and smoke tests.
    inline_worker: bool = False
    inline_worker_concurrency: int = 2

    # --- security ---------------------------------------------------------
    # Signing key for download tokens. Generated per-process when unset, which
    # is fine for a single dev server but MUST be pinned in production so the
    # API and any replica agree on token signatures.
    secret_key: str = Field(default_factory=lambda: secrets.token_urlsafe(48))
    download_token_ttl: int = 3600
    api_key: str | None = None
    # NoDecode stops pydantic-settings from JSON-parsing the raw env value, so
    # the documented comma-separated form reaches the validator below instead of
    # blowing up with a JSONDecodeError before it ever runs.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    )

    # --- database & accounts ---------------------------------------------
    # Defaults to SQLite inside the storage root, which needs no setup. Set a
    # postgresql+psycopg:// URL in production.
    database_url: str | None = None
    # Startup resilience: on Railway the api service can boot before its
    # Postgres is accepting connections, so the first connection is retried
    # with backoff instead of letting the container crash-loop out. The connect
    # timeout keeps a stuck connect from hanging past the platform healthcheck.
    db_connect_timeout: int = 10
    db_connect_max_attempts: int = 12
    allow_registration: bool = True
    min_password_length: int = 8
    trusted_email_domains: list[str] | str = [
        "gmail.com",
        "googlemail.com",
        "hotmail.com",
        "hotmail.co.uk",
        "hotmail.fr",
        "hotmail.de",
        "hotmail.es",
        "hotmail.it",
        "outlook.com",
        "outlook.co.uk",
        "outlook.fr",
        "outlook.de",
        "live.com",
        "live.co.uk",
        "live.fr",
        "msn.com",
        "icloud.com",
        "me.com",
        "mac.com",
        "yahoo.com",
        "yahoo.co.uk",
        "yahoo.fr",
        "yahoo.de",
        "yahoo.es",
        "yahoo.it",
        "yahoo.ca",
        "ymail.com",
        "rocketmail.com",
        "proton.me",
        "protonmail.com",
        "protonmail.ch",
        "pm.me",
        "tuta.com",
        "tuta.io",
        "tutanota.com",
        "tutanota.de",
        "fastmail.com",
        "fastmail.fm",
        "hey.com",
        "aol.com",
        "zoho.com",
        "zohomail.com",
        "gmx.com",
        "gmx.de",
        "gmx.net",
        "gmx.fr",
        "mail.com",
        "laposte.net",
        "orange.fr",
        "wanadoo.fr",
        "free.fr",
        "sfr.fr",
        "web.de",
        "t-online.de",
        "comcast.net",
        "verizon.net",
        "att.net",
        "btinternet.com",
        "sky.com",
    ]
    session_ttl_hours: int = 24 * 14

    # Comma-separated sign-in emails that are always admins. This is how the
    # first admin gets in; more can then be promoted from the admin panel.
    admin_emails: Annotated[list[str], NoDecode] = Field(default_factory=list)
    # Optional password for the first ADCAM_ADMIN_EMAILS address. When set, that
    # account is created (or its password reset) on every start, so the owner
    # can sign in without signing up first. See accounts.ensure_admin_account.
    admin_password: SecretStr | None = None
    # Plan given to new sign-ups (see app/plans.py for the list).
    default_plan: str = "free"

    # Session cookie. When the API and the web UI sit on different domains the
    # cookie must be SameSite=None and Secure, or the browser drops it.
    cookie_name: str = "adcam_session"
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    cookie_domain: str | None = None

    # --- billing (Whop) ---------------------------------------------------
    # Token plans and top-ups are sold through Whop Embedded Checkout. Until both
    # API key and webhook secret are set, checkout answers 503 and the plan page
    # says payments are being set up.
    whop_api_key: SecretStr | None = None
    whop_webhook_secret: SecretStr | None = None
    # Map internal subscription tiers ("starter", "pro", "max") and top-up dollar
    # amounts ("20", "40", "80", "160", "240") to Whop dashboard `plan_xxx` ids.
    # Accepts either JSON (`{"starter":"plan_..."}`) or comma-separated pairs
    # (`starter=plan_...,pro=plan_...`).
    whop_plan_subscription: Annotated[dict[str, str], NoDecode] = Field(default_factory=dict)
    whop_plan_topup: Annotated[dict[str, str], NoDecode] = Field(default_factory=dict)
    # Site origin used for Meta CAPI, Telegram approval webhook, and checkout returnUrl.
    public_url: str = ""

    # --- Meta Pixel + Conversions API ----------------------------------------
    # Both empty = no tracking at all. The Pixel id is public (the browser
    # loads it); the CAPI access token is a secret, set only on Railway.
    meta_pixel_id: str = ""
    meta_capi_token: SecretStr | None = None
    # Optional: the code from Events Manager > Test events, so server events
    # show there while testing. Remove it once the test is done.
    meta_test_event_code: str = ""
    meta_graph_version: str = "v21.0"

    # --- phone alerts (Telegram / ntfy) -----------------------------------
    # Off until a channel is set. See docs/PHONE_ALERTS.md. The bot token is
    # a secret, set only on Railway.
    notify_telegram_bot_token: SecretStr | None = None
    notify_telegram_chat_id: str = ""
    notify_ntfy_topic: str = ""
    notify_ntfy_url: str = "https://ntfy.sh"
    notify_ntfy_token: SecretStr | None = None
    # Which alerts to send, comma separated: plan_click, checkout, paid,
    # review. Empty = all of them.
    notify_events: Annotated[list[str], NoDecode] = Field(default_factory=list)
    # The same alert (same event, person and plan) at most once per this many seconds.
    notify_dedupe_seconds: int = 120
    # Approve / Reject buttons under Telegram payment alerts (see
    # docs/PHONE_ALERTS.md). On by default once Telegram is set up; they work
    # after Admin > Settings > Phone alerts > Connect buttons.
    notify_telegram_buttons: bool = True
    # Telegram user ids allowed to press the buttons, comma separated. Empty =
    # the chat id when it is a private chat (a positive number). A group chat
    # (negative id) needs this list, or nobody can press.
    notify_telegram_approver_ids: Annotated[list[str], NoDecode] = Field(default_factory=list)
    # Optional: the secret Telegram sends back on every button press. When
    # empty it is derived from the bot token, so nothing else has to be set.
    notify_telegram_webhook_secret: SecretStr | None = None

    # --- customer email ---------------------------------------------------
    # Optional. Any SMTP server works (Gmail/Google Workspace, Zoho, Brevo,
    # Mailgun, Amazon SES, ...); SMTP wins when both it and Resend are set.
    # With neither, welcome / plan activated / reminder emails are skipped.
    smtp_host: str = ""
    smtp_port: int = 587
    # starttls (port 587, the usual), ssl (port 465) or none (local relay only).
    smtp_security: str = "starttls"
    smtp_username: str = ""
    smtp_password: SecretStr | None = None
    resend_api_key: SecretStr | None = None
    email_from: str = "ProteusFlow <hello@proteusflow.com>"
    # Where customer replies go (Cloudflare Email Routing forwards it to the
    # owner's inbox). Set ADCAM_EMAIL_REPLY_TO to "" to send replies back to
    # the From address instead.
    email_reply_to: str = "support@proteusflow.com"

    # --- sign-in with Google -------------------------------------------------
    # The button appears on the login and sign-up pages once both are
    # set on the api service. See docs/LOGIN.md for where to get them.
    google_client_id: str = ""
    google_client_secret: SecretStr | None = None
    # Minutes a code emailed for sign-up, password reset or a change stays valid.
    email_code_minutes: int = 15

    # --- media engine -----------------------------------------------------
    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"
    ffmpeg_threads: int = 0  # 0 => let ffmpeg pick
    job_timeout_seconds: int = 60 * 45
    video_max_duration: int = 60 * 30

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept either a comma-separated string or a JSON array."""

        if isinstance(value, str):
            candidate = value.strip()
            if candidate.startswith("["):
                import json

                try:
                    parsed = json.loads(candidate)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, list):
                    return [str(origin).strip() for origin in parsed if str(origin).strip()]
            return [origin.strip() for origin in candidate.split(",") if origin.strip()]
        return value

    @field_validator("admin_emails", mode="before")
    @classmethod
    def _split_admin_emails(cls, value: object) -> object:
        if isinstance(value, str):
            return [email.strip().lower() for email in value.split(",") if email.strip()]
        if isinstance(value, list):
            return [str(email).strip().lower() for email in value if str(email).strip()]
        return value

    @field_validator("notify_events", "notify_telegram_approver_ids", mode="before")
    @classmethod
    def _split_list(cls, value: object) -> object:
        if isinstance(value, str):
            return [entry.strip() for entry in value.split(",") if entry.strip()]
        if isinstance(value, list):
            return [str(entry).strip() for entry in value if str(entry).strip()]
        return value

    @field_validator("trusted_email_domains", mode="before")
    @classmethod
    def _split_domains(cls, value: object) -> list[str]:
        if isinstance(value, str):
            items = [entry.strip().lower().lstrip("@") for entry in value.split(",") if entry.strip()]
            return list(dict.fromkeys(items))
        if isinstance(value, list):
            items = [str(entry).strip().lower().lstrip("@") for entry in value if str(entry).strip()]
            return list(dict.fromkeys(items))
        return []

    @field_validator("whop_plan_subscription", "whop_plan_topup", mode="before")
    @classmethod
    def _parse_plan_map(cls, value: object) -> dict[str, str]:
        if value is None or value == "":
            return {}
        if isinstance(value, dict):
            return {str(k).strip().lower(): str(v).strip() for k, v in value.items() if str(k).strip() and str(v).strip()}
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return {}
            if raw.startswith("{"):
                import json

                parsed = json.loads(raw)
                if not isinstance(parsed, dict):
                    raise ValueError("Plan map JSON must be an object.")
                return {str(k).strip().lower(): str(v).strip() for k, v in parsed.items() if str(k).strip() and str(v).strip()}
            out: dict[str, str] = {}
            for pair in raw.split(","):
                pair = pair.strip()
                if not pair:
                    continue
                sep = "=" if "=" in pair else ":" if ":" in pair else ""
                if not sep:
                    raise ValueError(f"Expected key=plan_id entry, got {pair!r}.")
                k, _, v = pair.partition(sep)
                if k.strip() and v.strip():
                    out[k.strip().lower()] = v.strip()
            return out
        raise ValueError("Plan map must be a JSON object or comma-separated key=plan_id pairs.")

    @field_validator("storage_root", mode="before")
    @classmethod
    def _expand_path(cls, value: object) -> object:
        if isinstance(value, str):
            return Path(os.path.expanduser(value))
        return value

    @property
    def broker_url(self) -> str:
        return self.celery_broker_url or self.redis_url

    @property
    def result_backend(self) -> str:
        return self.celery_result_backend or self.redis_url

    @property
    def uploads_dir(self) -> Path:
        return self.storage_root / "uploads"

    @property
    def outputs_dir(self) -> Path:
        return self.storage_root / "outputs"

    @property
    def work_dir(self) -> Path:
        return self.storage_root / "work"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def resolved_database_url(self) -> str:
        if not self.database_url:
            return f"sqlite:///{(self.storage_root / 'adcamouflage.db').as_posix()}"

        url = self.database_url.strip()
        # Managed providers (Railway, Heroku, Render) hand out bare
        # postgresql:// or the legacy postgres:// form. SQLAlchemy then reaches
        # for psycopg2, which is not installed - this project uses psycopg 3.
        # Naming the driver here turns a confusing ModuleNotFoundError at boot
        # into a URL that simply works.
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix) :]
        return url

    @property
    def whop_configured(self) -> bool:
        """True once Whop API key and webhook secret are both set."""

        key = self.whop_api_key.get_secret_value() if self.whop_api_key else ""
        secret = self.whop_webhook_secret.get_secret_value() if self.whop_webhook_secret else ""
        return bool(key.strip() and secret.strip())

    @property
    def google_ready(self) -> bool:
        secret = self.google_client_secret.get_secret_value() if self.google_client_secret else ""
        return bool(self.google_client_id.strip() and secret.strip())

    @property
    def billing_configured(self) -> bool:
        """True when Whop is set up, so a checkout can be offered."""

        return self.whop_configured

    @property
    def cookie_samesite_value(self) -> str:
        value = (self.cookie_samesite or "lax").lower()
        return value if value in {"lax", "strict", "none"} else "lax"

    def ensure_dirs(self) -> None:
        for path in (self.uploads_dir, self.outputs_dir, self.work_dir):
            path.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings


settings = get_settings()
