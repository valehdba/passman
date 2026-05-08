"""Tests for the security hardening landed in the auth-hardening-phase-1 PR."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from passman.models import User

from .conftest import make_register_payload


@pytest.mark.asyncio
async def test_login_rehashes_when_params_upgraded(client, session_factory, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Stored auth_hash should be silently upgraded when server params strengthen."""
    from passman.routers import sessions as sessions_router

    reg = make_register_payload("rehash@example.com")
    r = await client.post("/api/accounts/register", json=reg)
    assert r.status_code == 201

    # Capture the original stored hash.
    async with session_factory() as s:
        original = (
            await s.execute(select(User).where(User.email == "rehash@example.com"))
        ).scalar_one()
        original_hash = original.auth_hash

    # Force a "needs rehash" signal regardless of current settings, then log in.
    # Patch the symbol in the router's namespace — that's where login() resolves it.
    monkeypatch.setattr(sessions_router, "auth_hash_needs_rehash", lambda _stored: True)

    r = await client.post(
        "/api/sessions",
        json={"email": "rehash@example.com", "auth_key": reg["auth_key"]},
    )
    assert r.status_code == 201

    # Hash must have been replaced (Argon2 includes a fresh salt → different output).
    async with session_factory() as s:
        updated = (
            await s.execute(select(User).where(User.email == "rehash@example.com"))
        ).scalar_one()
        assert updated.auth_hash != original_hash, "auth_hash was not upgraded on login"


@pytest.mark.asyncio
async def test_refresh_rejects_deleted_user_token(client, session_factory) -> None:  # type: ignore[no-untyped-def]
    """Refresh tokens for users whose row has been removed must 401."""
    reg = make_register_payload("doomed@example.com")
    await client.post("/api/accounts/register", json=reg)
    login = await client.post(
        "/api/sessions",
        json={"email": "doomed@example.com", "auth_key": reg["auth_key"]},
    )
    body = login.json()

    # Delete the user. CASCADE should remove the session row, but we want to
    # prove the refresh endpoint still 401s (defense in depth).
    async with session_factory() as s:
        user = (
            await s.execute(select(User).where(User.email == "doomed@example.com"))
        ).scalar_one()
        await s.delete(user)
        await s.commit()

    r = await client.post("/api/sessions/refresh", json={"refresh_token": body["refresh_token"]})
    assert r.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "registered, login_attempt",
    [
        ("Mixed.Case@Example.com", "mixed.case@example.com"),
        ("with-spaces@example.com", "  with-spaces@example.com  "),
        ("UPPER@EXAMPLE.COM", "upper@example.com"),
    ],
)
async def test_email_normalization_at_schema_layer(client, registered, login_attempt) -> None:  # type: ignore[no-untyped-def]
    """Register and login should accept any case/whitespace variant of the same email."""
    reg = make_register_payload(registered)
    r = await client.post("/api/accounts/register", json=reg)
    assert r.status_code == 201, r.text

    r = await client.post(
        "/api/sessions",
        json={"email": login_attempt, "auth_key": reg["auth_key"]},
    )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_kdf_lookup_unknown_user_returns_decoy_with_normalized_email(
    client,
) -> None:  # type: ignore[no-untyped-def]
    """Decoy salt must be derived from the normalized form, so case-only variants match."""
    a = await client.get("/api/accounts/kdf", params={"email": "Ghost@Example.com"})
    b = await client.get("/api/accounts/kdf", params={"email": "  ghost@example.com"})
    assert a.status_code == 200
    assert b.status_code == 200
    assert a.json()["kdf_salt"] == b.json()["kdf_salt"]
