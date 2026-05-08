"""Tests for the accounts router."""

from __future__ import annotations

import pytest

from .conftest import make_register_payload


@pytest.mark.asyncio
async def test_register_creates_account(client) -> None:  # type: ignore[no-untyped-def]
    payload = make_register_payload("alice@example.com")
    resp = await client.post("/api/accounts/register", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["email"] == "alice@example.com"
    assert "user_id" in body


@pytest.mark.asyncio
async def test_register_duplicate_email_rejected(client) -> None:  # type: ignore[no-untyped-def]
    payload = make_register_payload("dup@example.com")
    r1 = await client.post("/api/accounts/register", json=payload)
    assert r1.status_code == 201
    r2 = await client.post("/api/accounts/register", json=payload)
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_register_validates_kdf_bounds(client) -> None:  # type: ignore[no-untyped-def]
    payload = make_register_payload()
    payload["kdf_memory_cost"] = 100  # below minimum
    resp = await client.post("/api/accounts/register", json=payload)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_register_rejects_malformed_blob(client) -> None:  # type: ignore[no-untyped-def]
    payload = make_register_payload()
    payload["encrypted_symmetric_key"] = "not-a-valid-blob"
    resp = await client.post("/api/accounts/register", json=payload)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_kdf_lookup_returns_real_params_for_known_user(client) -> None:  # type: ignore[no-untyped-def]
    payload = make_register_payload("known@example.com")
    await client.post("/api/accounts/register", json=payload)

    resp = await client.get("/api/accounts/kdf", params={"email": "known@example.com"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["kdf_salt"] == payload["kdf_salt"]
    assert body["kdf_time_cost"] == payload["kdf_time_cost"]


@pytest.mark.asyncio
async def test_kdf_lookup_returns_decoy_for_unknown_user(client) -> None:  # type: ignore[no-untyped-def]
    """Decoy params must be deterministic (same email → same salt) and look real."""
    r1 = await client.get("/api/accounts/kdf", params={"email": "ghost@example.com"})
    r2 = await client.get("/api/accounts/kdf", params={"email": "ghost@example.com"})
    r3 = await client.get("/api/accounts/kdf", params={"email": "other@example.com"})
    assert r1.status_code == r2.status_code == r3.status_code == 200
    assert r1.json()["kdf_salt"] == r2.json()["kdf_salt"]
    assert r1.json()["kdf_salt"] != r3.json()["kdf_salt"]
    # All have plausible length / shape
    assert 8 <= len(r1.json()["kdf_salt"]) <= 64


@pytest.mark.asyncio
async def test_kdf_lookup_normalizes_email_case(client) -> None:  # type: ignore[no-untyped-def]
    await client.post(
        "/api/accounts/register", json=make_register_payload("CaseSensitive@Example.com")
    )
    resp = await client.get("/api/accounts/kdf", params={"email": "casesensitive@example.com"})
    assert resp.status_code == 200
    body = resp.json()
    # If normalization works, we get the real salt (which is the constant in payload)
    assert body["kdf_salt"] == "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
