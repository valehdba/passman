"""Tests for login / refresh / logout."""

from __future__ import annotations

import pytest

from .conftest import make_register_payload


async def _register_and_login(client, email: str = "u@example.com"):  # type: ignore[no-untyped-def]
    reg = make_register_payload(email)
    r = await client.post("/api/accounts/register", json=reg)
    assert r.status_code == 201
    login_resp = await client.post(
        "/api/sessions",
        json={"email": email, "auth_key": reg["auth_key"]},
    )
    return reg, login_resp


@pytest.mark.asyncio
async def test_login_success_returns_tokens_and_enc_key(client) -> None:  # type: ignore[no-untyped-def]
    reg, resp = await _register_and_login(client)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["encrypted_symmetric_key"] == reg["encrypted_symmetric_key"]
    assert body["access_expires_in"] > 0
    assert body["refresh_expires_in"] > body["access_expires_in"]


@pytest.mark.asyncio
async def test_login_wrong_auth_key_returns_401(client) -> None:  # type: ignore[no-untyped-def]
    reg = make_register_payload("wrongpw@example.com")
    await client.post("/api/accounts/register", json=reg)
    resp = await client.post(
        "/api/sessions",
        json={"email": reg["email"], "auth_key": "z" * 64},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_user_returns_401(client) -> None:  # type: ignore[no-untyped-def]
    resp = await client.post(
        "/api/sessions",
        json={"email": "nobody@example.com", "auth_key": "z" * 64},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_returns_new_access_token(client) -> None:  # type: ignore[no-untyped-def]
    _, login_resp = await _register_and_login(client, "ref@example.com")
    refresh = login_resp.json()["refresh_token"]
    resp = await client.post("/api/sessions/refresh", json={"refresh_token": refresh})
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    assert body["access_token"] != login_resp.json()["access_token"]


@pytest.mark.asyncio
async def test_refresh_with_invalid_token_returns_401(client) -> None:  # type: ignore[no-untyped-def]
    resp = await client.post("/api/sessions/refresh", json={"refresh_token": "garbage"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_logout_revokes_refresh_token(client) -> None:  # type: ignore[no-untyped-def]
    _, login_resp = await _register_and_login(client, "out@example.com")
    body = login_resp.json()
    headers = {"Authorization": f"Bearer {body['access_token']}"}

    delete = await client.request(
        "DELETE",
        "/api/sessions",
        headers=headers,
        json={"refresh_token": body["refresh_token"]},
    )
    assert delete.status_code == 204

    # The refresh token must no longer work
    after = await client.post(
        "/api/sessions/refresh", json={"refresh_token": body["refresh_token"]}
    )
    assert after.status_code == 401


@pytest.mark.asyncio
async def test_logout_requires_auth(client) -> None:  # type: ignore[no-untyped-def]
    resp = await client.request("DELETE", "/api/sessions", json={"refresh_token": "anything"})
    assert resp.status_code == 403  # HTTPBearer auto_error -> 403 by default
