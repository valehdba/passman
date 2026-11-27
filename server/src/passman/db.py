"""Async SQLAlchemy engine, session factory, and declarative base."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import ClassVar

from sqlalchemy import DateTime
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import get_settings


def make_engine(url: str) -> AsyncEngine:
    """Build an async engine for ``url`` (pool tuning is skipped for SQLite)."""
    kwargs: dict[str, object] = {"echo": False, "pool_pre_ping": True}
    # SQLite (used in tests) doesn't support QueuePool tuning params.
    if not url.startswith("sqlite"):
        kwargs["pool_size"] = 10
        kwargs["max_overflow"] = 20
    return create_async_engine(url, **kwargs)


class _Runtime:
    """Holds the live engine/session factory so they can be swapped at runtime."""

    def __init__(self, engine: AsyncEngine) -> None:
        self.engine = engine
        self.sessions = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


_runtime = _Runtime(make_engine(get_settings().database_url))


def current_engine() -> AsyncEngine:
    return _runtime.engine


async def switch_engine(new_engine: AsyncEngine) -> None:
    """Point the app at ``new_engine`` and dispose the previous one.

    In-flight requests keep their already-open sessions; new requests use the
    new engine. The old *database* is never modified.
    """
    old = _runtime.engine
    _runtime.engine = new_engine
    _runtime.sessions = async_sessionmaker(new_engine, expire_on_commit=False, class_=AsyncSession)
    await old.dispose()


class Base(DeclarativeBase):
    """Declarative base with timestamp mixin defaults."""

    type_annotation_map: ClassVar[dict[type, object]] = {datetime: DateTime(timezone=True)}


def _utcnow() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    """Adds created_at / updated_at columns."""

    created_at: Mapped[datetime] = mapped_column(default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(default=_utcnow, onupdate=_utcnow, nullable=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a session that commits on success, rolls back on error."""
    async with _runtime.sessions() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
