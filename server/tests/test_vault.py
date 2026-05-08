"""Tests for the vault router — including isolation between users."""

from __future__ import annotations

import pytest

from .conftest import make_register_payload, make_vault_payload


async def _login(client, email: str = "vault@example.com"):  # type: ignore[no-untyped-def]
    reg = make_register_payload(email)
    await client.post("/api/accounts/register", json=reg)
    resp = await client.post("/api/sessions", json={"email": email, "auth_key": reg["auth_key"]})
    return resp.json()


def _auth_headers(login_body: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {login_body['access_token']}"}


@pytest.mark.asyncio
async def test_create_then_list_item(client) -> None:  # type: ignore[no-untyped-def]
    body = await _login(client)
    headers = _auth_headers(body)

    create = await client.post("/api/vault/items", json=make_vault_payload(), headers=headers)
    assert create.status_code == 201
    item_id = create.json()["id"]

    listing = await client.get("/api/vault/items", headers=headers)
    assert listing.status_code == 200
    items = listing.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == item_id


@pytest.mark.asyncio
async def test_get_update_delete_item(client) -> None:  # type: ignore[no-untyped-def]
    body = await _login(client)
    headers = _auth_headers(body)
    item_id = (
        await client.post("/api/vault/items", json=make_vault_payload(), headers=headers)
    ).json()["id"]

    g = await client.get(f"/api/vault/items/{item_id}", headers=headers)
    assert g.status_code == 200

    upd = await client.patch(
        f"/api/vault/items/{item_id}",
        json={"encrypted_data": "v2:EEEEEEEEEEEEEEEE:FFFFFFFFFFFFFFFF"},
        headers=headers,
    )
    assert upd.status_code == 200
    assert upd.json()["encrypted_data"].startswith("v2:")

    d = await client.delete(f"/api/vault/items/{item_id}", headers=headers)
    assert d.status_code == 204

    after = await client.get(f"/api/vault/items/{item_id}", headers=headers)
    assert after.status_code == 404


@pytest.mark.asyncio
async def test_users_cannot_see_each_others_items(client) -> None:  # type: ignore[no-untyped-def]
    """Critical authorization test."""
    alice = await _login(client, "alice-iso@example.com")
    bob = await _login(client, "bob-iso@example.com")

    a_create = await client.post(
        "/api/vault/items",
        json=make_vault_payload(),
        headers=_auth_headers(alice),
    )
    a_id = a_create.json()["id"]

    # Bob should not see Alice's item
    b_listing = await client.get("/api/vault/items", headers=_auth_headers(bob))
    assert b_listing.json()["items"] == []

    # Bob should not be able to fetch Alice's item by id
    b_get = await client.get(f"/api/vault/items/{a_id}", headers=_auth_headers(bob))
    assert b_get.status_code == 404

    # Bob cannot delete Alice's item
    b_del = await client.delete(f"/api/vault/items/{a_id}", headers=_auth_headers(bob))
    assert b_del.status_code == 404


@pytest.mark.asyncio
async def test_vault_requires_auth(client) -> None:  # type: ignore[no-untyped-def]
    resp = await client.get("/api/vault/items")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_vault_rejects_oversized_blob(client) -> None:  # type: ignore[no-untyped-def]
    body = await _login(client, "big@example.com")
    headers = _auth_headers(body)
    huge = "v1:AAAAAAAAAAAAAAAA:" + ("A" * (64 * 1024))
    resp = await client.post(
        "/api/vault/items",
        json={"item_type": "login", "encrypted_data": huge},
        headers=headers,
    )
    assert resp.status_code == 422
