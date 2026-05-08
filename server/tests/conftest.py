"""Pytest fixtures.

Strategy: each test gets a fresh in-memory SQLite DB. The production app uses
PostgreSQL, but the schema is portable enough for SQLite to exercise our
business logic. CI also runs an integration job against a real Postgres
service container — see .github/workflows/ci.yml.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Force a known JWT secret + sqlite URL BEFORE importing app modules.
os.environ["JWT_SECRET"] = "test-secret-not-for-production-1234567890abcdef"
os.environ["ENV"] = "test"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"

from passman.db import Base
from passman.deps import get_session
from passman.main import create_app


@pytest.fixture
async def engine():  # type: ignore[no-untyped-def]
    eng = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield eng
    finally:
        await eng.dispose()


@pytest.fixture
async def session_factory(engine):  # type: ignore[no-untyped-def]
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture
async def client(session_factory) -> AsyncIterator[AsyncClient]:  # type: ignore[no-untyped-def]
    app = create_app()

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as s:
            try:
                yield s
                await s.commit()
            except Exception:
                await s.rollback()
                raise

    app.dependency_overrides[get_session] = override_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


def make_register_payload(email: str | None = None) -> dict[str, object]:
    """Build a syntactically valid registration body.

    Crypto values here are illustrative — they pass the wire schema but are
    NOT the result of real KDF runs. We test KDF correctness in the TS suite.
    """
    return {
        "email": email or f"user-{uuid.uuid4().hex[:8]}@example.com",
        "kdf_salt": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",  # 32 chars base64-ish
        "kdf_time_cost": 3,
        "kdf_memory_cost": 65_536,
        "kdf_parallelism": 4,
        # Auth key: 32+ chars, treated opaquely by server.
        "auth_key": "deadbeef" * 8,
        "encrypted_symmetric_key": "v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBB",
    }


def make_vault_payload(item_type: str = "login") -> dict[str, str]:
    return {
        "item_type": item_type,
        "encrypted_data": "v1:CCCCCCCCCCCCCCCC:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    }
