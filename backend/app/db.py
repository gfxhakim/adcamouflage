"""Database engine, session handling and ORM models.

SQLite is the default so the app runs with no setup at all; production points
``ADCAM_DATABASE_URL`` at Postgres and nothing else changes.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Iterator

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    event,
    func,
    inspect,
    text,
)
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

from .config import settings

logger = logging.getLogger(__name__)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Stored lower-cased and unique, so sign-in is case-insensitive.
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Bumped on password change so every existing session token stops
    # validating - this is what makes "sign out everywhere" work.
    token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # --- admin & subscription ------------------------------------------------
    # Admins can open /admin. ADCAM_ADMIN_EMAILS also grants it, which is how
    # the very first admin is created.
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # A label from plans.PLANS; the quota below is what is actually enforced.
    plan: Mapped[str] = mapped_column(String(32), default="unlimited", nullable=False)
    # Files a user may process per calendar month. None means unlimited.
    monthly_quota: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # After this moment the user cannot start new batches until it is extended.
    plan_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Usage is counted from the later of this and the start of the month, so an
    # admin can hand back a user's allowance mid-month.
    usage_reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Private notes the admin keeps about this customer.
    admin_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # --- token billing (see app/tokens.py) -----------------------------------
    # 'legacy' keeps the monthly file quota above; 'tokens' is the paid
    # 30-day subscription with a token balance. Accounts that predate token
    # billing stay legacy until they buy a plan; new sign-ups start on tokens.
    billing_mode: Mapped[str] = mapped_column(String(16), default="legacy", nullable=False)
    # The plan of the current (or last) paid period; None = never subscribed.
    sub_plan: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sub_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The subscription is active while now < sub_period_end.
    sub_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set when the user cancels; access runs to sub_period_end, then no rollover.
    sub_cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Snapshot of the plan's tokens_per_generation at purchase, used to price
    # every batch for the rest of the period even if the admin reprices plans.
    sub_tokens_per_generation: Mapped[int | None] = mapped_column(Integer, nullable=True)

    batches: Mapped[list["BatchRecord"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<User {self.id} {self.email}>"


class BatchRecord(Base):
    """A durable record of a submitted batch.

    Live progress lives in Redis and expires with the retention window; this
    table is what lets a signed-in user still see their history afterwards.
    """

    __tablename__ = "batches"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    asset_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    preset: Mapped[str] = mapped_column(String(32), default="balanced", nullable=False)
    options_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False, index=True
    )

    user: Mapped[User] = relationship(back_populates="batches")


class AppSetting(Base):
    """Settings an admin changes from the panel, stored as JSON per key."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class TokenLedger(Base):
    """One signed movement of tokens. A user's balance is the sum per bucket.

    ``bucket`` is 'subscription' (granted each period, subject to rollover) or
    'topup' (bought extra, never expires, frozen while the subscription lapses).
    ``kind`` says why: grant, rollover, expire, topup, bonus, consume, refund
    or admin. Nothing in this table is ever updated or deleted, so the history
    an admin sees is exactly what happened.
    """

    __tablename__ = "token_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    bucket: Mapped[str] = mapped_column(String(16), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    batch_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    order_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False, index=True
    )


class Order(Base):
    """A purchase: a subscription period or a top-up, paid through BTCPay or Volet.

    ``status`` moves pending -> paid, or pending -> expired / invalid when
    the invoice lapses or the provider reports a cancellation; a payment the
    provider confirms late still moves it to paid. A paid order is applied
    to the ledger exactly once: settlement claims the row with a conditional
    UPDATE in the same transaction as the ledger rows, so a notification
    delivered twice, or a webhook and a poll that overlap, credit it once.
    """

    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # subscription | topup
    plan_id: Mapped[str] = mapped_column(String(32), nullable=False)
    amount_usd: Mapped[float] = mapped_column(Float, nullable=False)
    # What the buyer was quoted at checkout and is credited at settlement,
    # whatever the admin changes in between: tokens (bonus included), the
    # bonus part of that, and the per-generation price of the period.
    tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    bonus_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    tokens_per_generation: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False, index=True)
    btcpay_invoice_id: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    # Which provider takes the money: 'btcpay' or 'volet'. Every order from
    # before Volet was a BTCPay one, hence the default.
    provider: Mapped[str] = mapped_column(String(16), default="btcpay", server_default="btcpay", nullable=False)
    # The provider's own id for the payment when it is not a BTCPay invoice
    # (Volet's transaction id, ``ac_transfer``, from the status notification).
    provider_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    checkout_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False, index=True
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # When the order poll last asked BTCPay about this invoice (throttles the poll).
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ActivityEvent(Base):
    """One line in the admin activity feed: a sign-up, sign-in, batch or change."""

    __tablename__ = "activity"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    detail: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now(), nullable=False, index=True
    )


_engine: Engine | None = None
_SessionFactory: sessionmaker[Session] | None = None


def _build_engine() -> Engine:
    url = settings.resolved_database_url
    connect_args: dict[str, object] = {}
    kwargs: dict[str, object] = {"pool_pre_ping": True, "future": True}

    if url.startswith("sqlite"):
        # FastAPI serves requests from a thread pool, so the connection must be
        # allowed to move between threads.
        connect_args["check_same_thread"] = False
        settings.storage_root.mkdir(parents=True, exist_ok=True)
    else:
        kwargs["pool_size"] = 5
        kwargs["max_overflow"] = 10
        # Fail a stuck connect fast so the startup retry loop can take over
        # rather than hanging past the platform healthcheck window. psycopg and
        # most other DBAPI drivers accept connect_timeout (in seconds).
        connect_args["connect_timeout"] = settings.db_connect_timeout

    engine = create_engine(url, connect_args=connect_args, **kwargs)

    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _record):  # type: ignore[no-untyped-def]
            cursor = dbapi_connection.cursor()
            # WAL keeps reads from blocking writes; foreign keys are off by
            # default in SQLite and the cascade delete depends on them.
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.close()

    return engine


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = _build_engine()
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    global _SessionFactory
    if _SessionFactory is None:
        _SessionFactory = sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)
    return _SessionFactory


# Columns added to tables that already exist in deployed databases. create_all
# only creates missing tables, so these are added by hand on start. Each entry
# is (table, column, SQL type and default).
_ADDED_COLUMNS: list[tuple[str, str, str]] = [
    ("users", "is_admin", "BOOLEAN NOT NULL DEFAULT FALSE"),
    # Accounts that existed before plans were introduced keep working as they
    # did: unlimited, until an admin moves them onto a plan.
    ("users", "plan", "VARCHAR(32) NOT NULL DEFAULT 'unlimited'"),
    ("users", "monthly_quota", "INTEGER"),
    ("users", "plan_expires_at", "TIMESTAMP WITH TIME ZONE"),
    ("users", "usage_reset_at", "TIMESTAMP WITH TIME ZONE"),
    ("users", "last_seen_at", "TIMESTAMP WITH TIME ZONE"),
    ("users", "admin_notes", "TEXT"),
    # Token billing. Rows that exist before the upgrade are legacy accounts and
    # keep their monthly quota; the register route puts new sign-ups on tokens.
    ("users", "billing_mode", "VARCHAR(16) NOT NULL DEFAULT 'legacy'"),
    ("users", "sub_plan", "VARCHAR(32)"),
    ("users", "sub_period_start", "TIMESTAMP WITH TIME ZONE"),
    ("users", "sub_period_end", "TIMESTAMP WITH TIME ZONE"),
    ("users", "sub_cancelled_at", "TIMESTAMP WITH TIME ZONE"),
    ("users", "sub_tokens_per_generation", "INTEGER"),
    ("orders", "bonus_tokens", "INTEGER NOT NULL DEFAULT 0"),
    ("orders", "tokens_per_generation", "INTEGER"),
    ("orders", "checked_at", "TIMESTAMP WITH TIME ZONE"),
    # Second payment provider (Volet). Every order before it was a BTCPay one.
    ("orders", "provider", "VARCHAR(16) NOT NULL DEFAULT 'btcpay'"),
    ("orders", "provider_ref", "VARCHAR(128)"),
]


def _add_missing_columns(engine: Engine) -> None:
    for table, column, ddl in _ADDED_COLUMNS:
        existing = {col["name"] for col in inspect(engine).get_columns(table)}
        if column in existing:
            continue
        try:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
            logger.info("added column %s.%s", table, column)
        except Exception:  # noqa: BLE001 - another process may have just added it
            if column not in {col["name"] for col in inspect(engine).get_columns(table)}:
                raise


def _wait_for_database(engine: Engine) -> None:
    """Block until the database accepts a connection, retrying with backoff.

    On Railway the api container can start before its managed Postgres is
    ready, so a single connection attempt would raise, kill application
    startup and (after the restart cap) leave the service down. Retrying a
    light ``SELECT 1`` lets a database that is still coming up - or one that
    hiccups during a deploy - be picked up on a later attempt instead. SQLite
    is always local, so it needs no wait.
    """

    url = settings.resolved_database_url
    if url.startswith("sqlite"):
        return

    attempts = max(1, settings.db_connect_max_attempts)
    delay = 1.0
    for attempt in range(1, attempts + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            if attempt > 1:
                logger.info("database reachable after %s attempt(s)", attempt)
            return
        except OperationalError as exc:
            if attempt == attempts:
                logger.error(
                    "database still unreachable after %s attempts: %s", attempts, exc
                )
                raise
            logger.warning(
                "database not ready (attempt %s/%s), retrying in %.1fs",
                attempt,
                attempts,
                delay,
            )
            time.sleep(delay)
            delay = min(delay * 2, 10.0)


def init_db() -> None:
    """Create any missing tables and columns. Safe to call on every start."""

    engine = get_engine()
    _wait_for_database(engine)
    Base.metadata.create_all(bind=engine)
    _add_missing_columns(engine)
    logger.info("database ready at %s", settings.resolved_database_url.split("@")[-1])


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a session that always closes."""

    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


def reset_engine() -> None:
    """Drop the cached engine. Used by tests that switch database URLs."""

    global _engine, _SessionFactory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionFactory = None
