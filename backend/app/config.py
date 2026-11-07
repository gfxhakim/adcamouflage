"""Runtime configuration for the AdCamouflage backend.

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
    app_name: str = "AdCamouflage"
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
    min_password_length: int = 10
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

    # --- billing (BTCPay Server) ------------------------------------------
    # Token plans are sold through a self-hosted BTCPay Server (Greenfield
    # API). Until all three of url, store id and API key are set, checkout
    # answers 503 and the plan page says payments are being set up.
    btcpay_url: str = ""  # e.g. https://pay.example.com, no trailing slash
    btcpay_store_id: str = ""
    btcpay_api_key: SecretStr | None = None
    # Secret entered on the BTCPay webhook; every delivery is HMAC-checked.
    btcpay_webhook_secret: SecretStr | None = None
    # Site origin the payment provider sends the customer back to after
    # paying. Empty means use the request's Origin/Referer, or a relative
    # /app/plan link for BTCPay. Volet needs an absolute, short address, so
    # its pay page refuses to run without one (see app/volet.py).
    public_url: str = ""

    # --- billing (Volet Hosted Checkout, the "SCI") -----------------------
    # A second way to take payment, usable alongside BTCPay or on its own:
    # the customer's browser posts a signed form to Volet's hosted page and
    # Volet calls back with a signed status notification. Needs the
    # merchant's Volet account email, the name the gateway was given when it
    # was created and its password (security word). The plan page offers
    # whichever providers are set.
    volet_account_email: str = ""
    volet_sci_name: str = ""
    volet_sci_secret: SecretStr | None = None
    volet_sci_url: str = "https://account.volet.com/sci/"
    # Addresses (or ranges such as 203.0.113.0/24) a Volet status notification
    # may come from, comma separated. The default is the three senders Volet's
    # SCI document lists plus the "notification server" address Volet's
    # dashboard shows on a Hosted Checkout's Payment methods tab (seen
    # 2026-10-30), which the document does not mention. The hash on a
    # notification does not cover its status field, so a buyer who receives a
    # genuine one could send it again as COMPLETED; checking the sender closes
    # that. Empty turns the check off.
    volet_notify_ips: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["50.7.115.5", "51.255.40.139", "13.53.55.89", "13.61.247.159"]
    )

    # How far below the order price the amount Volet reports may be and still
    # activate the plan automatically, in percent of the price. Volet can take
    # its processing fee out of the payment (a $37.50 USDT payment credited as
    # $37.25), which would otherwise leave every order waiting for a manual
    # approval. 0 = the amount must match exactly. Anything further below the
    # price is set aside for review, as before.
    volet_fee_allowance_pct: float = Field(default=2.0, ge=0, le=10)

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
    email_from: str = "BluCloacking <billing@blucloack.online>"
    # Where customer replies go; empty = back to the From address.
    email_reply_to: str = ""

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

    @field_validator("volet_notify_ips", "notify_events", "notify_telegram_approver_ids", mode="before")
    @classmethod
    def _split_notify_ips(cls, value: object) -> object:
        if isinstance(value, str):
            return [entry.strip() for entry in value.split(",") if entry.strip()]
        if isinstance(value, list):
            return [str(entry).strip() for entry in value if str(entry).strip()]
        return value

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
    def btcpay_configured(self) -> bool:
        """True once BTCPay can be called: url, store id and API key all set."""

        key = self.btcpay_api_key.get_secret_value() if self.btcpay_api_key else ""
        return bool(self.btcpay_url.strip() and self.btcpay_store_id.strip() and key.strip())

    @property
    def volet_configured(self) -> bool:
        """True once a Volet form can be signed: account email, gateway name and password all set."""

        secret = self.volet_sci_secret.get_secret_value() if self.volet_sci_secret else ""
        return bool(self.volet_account_email.strip() and self.volet_sci_name.strip() and secret.strip())

    @property
    def billing_configured(self) -> bool:
        """True when at least one payment provider is set up, so a checkout can be offered."""

        return self.btcpay_configured or self.volet_configured

    @property
    def btcpay_base_url(self) -> str:
        return self.btcpay_url.strip().rstrip("/")

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
