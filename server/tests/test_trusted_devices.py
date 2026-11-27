"""Tests for "trust this device" (skip the OTP prompt on a remembered browser)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from passman import totp
from passman.config import get_settings
from passman.models import TrustedDevice

from .test_totp import _register_and_login, _setup_and_confirm_totp


def _h(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _login_with_otp(  # type: ignore[no-untyped-def]
    client, reg, secret, *, trust: bool = False, days: int | None = None, device_token=None
):
    """Full two-step login; returns the /sessions/otp JSON body."""
    body: dict[str, object] = {"email": reg["email"], "auth_key": reg["auth_key"]}
    if device_token:
        body["device_token"] = device_token
    ch = await client.post("/api/sessions", json=body)
    assert ch.status_code == 201, ch.text
    otp_token = ch.json()["otp_token"]
    payload: dict[str, object] = {
        "otp_token": otp_token,
        "code": totp.current_code(secret),
        "trust_device": trust,
    }
    if days is not None:
        payload["trust_days"] = days
    resp = await client.post("/api/sessions/otp", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _setup(client, email: str):  # type: ignore[no-untyped-def]
    reg, token = await _register_and_login(client, email)
    secret, _ = await _setup_and_confirm_totp(client, token)
    return reg, token, secret


async def _plain_login(client, reg, device_token=None):  # type: ignore[no-untyped-def]
    body = {"email": reg["email"], "auth_key": reg["auth_key"]}
    if device_token:
        body["device_token"] = device_token
    return (await client.post("/api/sessions", json=body)).json()


@pytest.mark.asyncio
async def test_no_device_token_unless_requested(client) -> None:  # type: ignore[no-untyped-def]
    reg, _t, secret = await _setup(client, "td1@example.com")
    body = await _login_with_otp(client, reg, secret, trust=False)
    assert body["device_token"] is None


@pytest.mark.asyncio
async def test_trusted_device_skips_otp_next_login(client) -> None:  # type: ignore[no-untyped-def]
    reg, _t, secret = await _setup(client, "td2@example.com")
    body = await _login_with_otp(client, reg, secret, trust=True, days=7)
    token = body["device_token"]
    assert token and len(token) >= 32
    assert body["device_token_expires_in"] == 7 * 86400

    # Same browser: password only, straight to a token pair.
    again = await _plain_login(client, reg, device_token=token)
    assert again.get("requires_otp") is None
    assert again["access_token"] and again["refresh_token"]

    # Different browser (no token): still challenged.
    other = await _plain_login(client, reg)
    assert other["requires_otp"] is True


@pytest.mark.asyncio
async def test_wrong_password_still_fails_with_valid_device_token(client) -> None:  # type: ignore[no-untyped-def]
    reg, _t, secret = await _setup(client, "td3@example.com")
    token = (await _login_with_otp(client, reg, secret, trust=True))["device_token"]
    resp = await client.post(
        "/api/sessions",
        json={"email": reg["email"], "auth_key": "0" * 64, "device_token": token},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_device_token_is_scoped_to_its_user(client) -> None:  # type: ignore[no-untyped-def]
    reg_a, _ta, secret_a = await _setup(client, "td4a@example.com")
    reg_b, _tb, _sb = await _setup(client, "td4b@example.com")
    token_a = (await _login_with_otp(client, reg_a, secret_a, trust=True))["device_token"]
    # B presenting A's token must still be challenged.
    assert (await _plain_login(client, reg_b, device_token=token_a))["requires_otp"] is True


@pytest.mark.asyncio
async def test_garbage_and_expired_tokens_fall_back_to_otp(client, session_factory) -> None:  # type: ignore[no-untyped-def]
    reg, _t, secret = await _setup(client, "td5@example.com")
    assert (await _plain_login(client, reg, device_token="x" * 43))["requires_otp"] is True

    token = (await _login_with_otp(client, reg, secret, trust=True))["device_token"]
    async with session_factory() as s:
        await s.execute(
            update(TrustedDevice).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await s.commit()
    assert (await _plain_login(client, reg, device_token=token))["requires_otp"] is True


@pytest.mark.asyncio
async def test_trust_days_clamped_to_server_max(client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(get_settings(), "trusted_device_max_days", 10)
    reg, _t, secret = await _setup(client, "td6@example.com")
    body = await _login_with_otp(client, reg, secret, trust=True, days=300)
    assert body["device_token_expires_in"] == 10 * 86400
    # Default applies when the client sends no period.
    monkeypatch.setattr(get_settings(), "trusted_device_default_days", 3)
    body2 = await _login_with_otp(client, reg, secret, trust=True)
    assert body2["device_token_expires_in"] == 3 * 86400


@pytest.mark.asyncio
async def test_token_stored_hashed_only(client, session_factory) -> None:  # type: ignore[no-untyped-def]
    reg, _t, secret = await _setup(client, "td7@example.com")
    token = (await _login_with_otp(client, reg, secret, trust=True))["device_token"]
    async with session_factory() as s:
        rows = (await s.execute(select(TrustedDevice))).scalars().all()
    assert len(rows) == 1
    assert rows[0].token_hash != token
    assert len(rows[0].token_hash) == 64


@pytest.mark.asyncio
async def test_disabling_2fa_revokes_all_trust(client) -> None:  # type: ignore[no-untyped-def]
    reg, access, secret = await _setup(client, "td8@example.com")
    token = (await _login_with_otp(client, reg, secret, trust=True))["device_token"]
    dis = await client.post(
        "/api/account/totp/disable",
        json={"code": totp.current_code(secret)},
        headers=_h(access),
    )
    assert dis.status_code == 204
    # Re-enable 2FA: the old trust must not survive.
    new_secret, _ = await _setup_and_confirm_totp(client, access)
    assert new_secret
    assert (await _plain_login(client, reg, device_token=token))["requires_otp"] is True
    lst = await client.get("/api/account/trusted-devices", headers=_h(access))
    assert lst.json() == []


@pytest.mark.asyncio
async def test_list_and_revoke_one_and_all(client) -> None:  # type: ignore[no-untyped-def]
    reg, access, secret = await _setup(client, "td9@example.com")
    t1 = (await _login_with_otp(client, reg, secret, trust=True))["device_token"]
    t2 = (await _login_with_otp(client, reg, secret, trust=True))["device_token"]
    lst = (await client.get("/api/account/trusted-devices", headers=_h(access))).json()
    assert len(lst) == 2
    assert {"id", "user_agent", "created_at", "last_used_at", "expires_at"} <= set(lst[0])
    assert "token" not in str(lst) and "token_hash" not in str(lst)

    # Revoke one → that token stops working, the other keeps working.
    gone = await client.delete(f"/api/account/trusted-devices/{lst[0]['id']}", headers=_h(access))
    assert gone.status_code == 204
    results = {
        t: (await _plain_login(client, reg, device_token=t)).get("requires_otp") for t in (t1, t2)
    }
    assert sorted(results.values(), key=str) == [None, True]

    # Revoke all.
    assert (
        await client.delete("/api/account/trusted-devices", headers=_h(access))
    ).status_code == 204
    assert (await _plain_login(client, reg, device_token=t1))["requires_otp"] is True
    assert (await _plain_login(client, reg, device_token=t2))["requires_otp"] is True
    assert (await client.get("/api/account/trusted-devices", headers=_h(access))).json() == []


@pytest.mark.asyncio
async def test_cannot_revoke_another_users_device(client) -> None:  # type: ignore[no-untyped-def]
    reg_a, access_a, secret_a = await _setup(client, "td10a@example.com")
    _reg_b, access_b, _sb = await _setup(client, "td10b@example.com")
    token_a = (await _login_with_otp(client, reg_a, secret_a, trust=True))["device_token"]
    dev_id = (await client.get("/api/account/trusted-devices", headers=_h(access_a))).json()[0][
        "id"
    ]
    r = await client.delete(f"/api/account/trusted-devices/{dev_id}", headers=_h(access_b))
    assert r.status_code == 204  # silent no-op
    assert (await _plain_login(client, reg_a, device_token=token_a)).get("requires_otp") is None


@pytest.mark.asyncio
async def test_per_user_cap_evicts_oldest(client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(get_settings(), "trusted_device_max_per_user", 2)
    reg, access, secret = await _setup(client, "td11@example.com")
    first = (await _login_with_otp(client, reg, secret, trust=True))["device_token"]
    await _login_with_otp(client, reg, secret, trust=True)
    third = (await _login_with_otp(client, reg, secret, trust=True))["device_token"]
    lst = (await client.get("/api/account/trusted-devices", headers=_h(access))).json()
    assert len(lst) == 2
    assert (await _plain_login(client, reg, device_token=first))["requires_otp"] is True
    assert (await _plain_login(client, reg, device_token=third)).get("requires_otp") is None


@pytest.mark.asyncio
async def test_endpoints_require_auth(client) -> None:  # type: ignore[no-untyped-def]
    assert (await client.get("/api/account/trusted-devices")).status_code == 401
    assert (await client.delete("/api/account/trusted-devices")).status_code == 401
