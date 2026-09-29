"""Database engine, session handling and ORM models.

SQLite is the default so the app runs with no setup at all; production points
``ADCAM_DATABASE_URL`` at Postgres and nothing else changes.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Iterator

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    event,
    func,
)
from sqlalchemy.engine import Engine
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


def init_db() -> None:
    """Create any missing tables. Safe to call on every start."""

    Base.metadata.create_all(bind=get_engine())
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
