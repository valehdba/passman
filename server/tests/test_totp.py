"""Tests for the TOTP / 2FA pipeline.

Covers three layers:
  - The pure utilities in `passman.totp` (verify, recovery codes,
    provisioning URI shape)
  - The /api/account/totp/* endpoints (setup → confirm → status → disable)
  - The two-step login flow (/api/sessions returning OtpChallenge,
    /api/sessions/otp completing with a code or recovery code)
"""

from __future__ import annotations

import time

import pytest

from passman import totp

from .conftest import make_register_payload


# ---------------------------------------------------------------------------
# Pure-function tests (no DB / no HTTP)
# ---------------------------------------------------------------------------


def test_generate_secret_is_20_bytes() -> None:
    s = totp.generate_secret()
    assert len(s) == 20
    # Two consecutive calls must differ — CSPRNG, not a fixed value.
    assert s != totp.generate_secret()


def test_secret_round_trips_through_base32() -> None:
    s = totp.generate_secret()
    encoded = totp.secret_to_base32(s)
    assert "=" not in encoded  # we strip padding for clean display
    assert totp.base32_to_secret(encoded) == s


def test_verify_accepts_current_window_and_rejects_wrong_codes() -> None:
    s = totp.generate_secret()
    code = totp.current_code(s)
    assert totp.verify(s, code) is True
    # The next 6-digit string (off by one) must not validate.
    bad = str((int(code) + 1) % 1_000_000).zfill(6)
    assert totp.verify(s, bad) is False


def test_verify_tolerates_one_window_of_clock_skew() -> None:
    s = totp.generate_secret()
    now = time.time()
    # The previous window's code should still verify.
    prev = totp.current_code(s, at_time=now - totp.PERIOD_SECONDS)
    assert totp.verify(s, prev, at_time=now) is True


def test_verify_rejects_two_windows_of_skew() -> None:
    s = totp.generate_secret()
    now = time.time()
    way_old = totp.current_code(s, at_time=now - 3 * totp.PERIOD_SECONDS)
    assert totp.verify(s, way_old, at_time=now) is False


def test_verify_strips_whitespace_and_dashes() -> None:
    s = totp.generate_secret()
    code = totp.current_code(s)
    formatted = f"{code[:3]} {code[3:]}"
    assert totp.verify(s, formatted) is True


def test_verify_rejects_non_digit_codes() -> None:
    s = totp.generate_secret()
    assert totp.verify(s, "abcdef") is False
    assert totp.verify(s, "") is False


def test_provisioning_uri_has_required_params() -> None:
    s = totp.generate_secret()
    uri = totp.build_provisioning_uri(s, account="alice@example.com", issuer="Passman")
    assert uri.startswith("otpauth://totp/")
    assert "secret=" in uri
    assert "issuer=Passman" in uri
    assert "algorithm=SHA1" in uri
    assert "digits=6" in uri
    assert "period=30" in uri
    # Label is `<issuer>:<account>` URL-encoded.
    assert "Passman:alice%40example.com" in uri


def test_recovery_codes_are_unique_and_correctly_shaped() -> None:
    codes = totp.generate_recovery_codes(count=10)
    assert len(codes) == 10
    assert len(set(codes)) == 10  # no duplicates
    for c in codes:
        assert len(c) == 9  # xxxx-xxxx
        assert c[4] == "-"


def test_recovery_codes_consume_once() -> None:
    codes = totp.generate_recovery_codes(count=3)
    stored = totp.hash_recovery_codes(codes)
    matched, remaining = totp.consume_recovery_code(stored, codes[1])
    assert matched is True
    assert remaining is not None
    # Same code can't be reused.
    matched_again, _ = totp.consume_recovery_code(remaining, codes[1])
    assert matched_again is False
    # The other codes still work.
    matched_other, _ = totp.consume_recovery_code(remaining, codes[0])
    assert matched_other is True


def test_recovery_codes_reject_garbage_input() -> None:
    codes = totp.generate_recovery_codes(count=2)
    stored = totp.hash_recovery_codes(codes)
    matched, remaining = totp.consume_recovery_code(stored, "not-a-real-code")
    assert matched is False
    assert remaining is None


# ---------------------------------------------------------------------------
# /api/account/totp/* endpoint tests
# ---------------------------------------------------------------------------


async def _register_and_login(client, email: str):  # type: ignore[no-untyped-def]
    reg = make_register_payload(email)
    r = await client.post("/api/accounts/register", json=reg)
    assert r.status_code == 201, r.text
    login = await client.post(
        "/api/sessions",
        json={"email": email, "auth_key": reg["auth_key"]},
    )
    assert login.status_code == 201, login.text
    return reg, login.json()["access_token"]


async def _setup_and_confirm_totp(client, access_token: str):  # type: ignore[no-untyped-def]
    """End-to-end helper: setup → confirm with the actual current code.
    Returns the secret bytes + the recovery codes so tests can use them."""
    setup = await client.post(
        "/api/account/totp/setup",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert setup.status_code == 201, setup.text
    body = setup.json()
    secret = totp.base32_to_secret(body["secret_base32"])
    code = totp.current_code(secret)
    confirm = await client.post(
        "/api/account/totp/confirm",
        json={"code": code},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert confirm.status_code == 200, confirm.text
    return secret, confirm.json()["recovery_codes"]


@pytest.mark.asyncio
async def test_totp_setup_returns_provisioning_uri_and_secret(client) -> None:  # type: ignore[no-untyped-def]
    _reg, token = await _register_and_login(client, "totp1@example.com")
    resp = await client.post(
        "/api/account/totp/setup",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["provisioning_uri"].startswith("otpauth://totp/")
    assert body["secret_base32"]


@pytest.mark.asyncio
async def test_totp_confirm_with_valid_code_enables_2fa_and_returns_recovery_codes(client) -> None:  # type: ignore[no-untyped-def]
    _reg, token = await _register_and_login(client, "totp2@example.com")
    _secret, codes = await _setup_and_confirm_totp(client, token)
    assert len(codes) == 10
    # Status now reports enabled.
    status_resp = await client.get(
        "/api/account/totp/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    body = status_resp.json()
    assert body["enabled"] is True
    assert body["recovery_codes_remaining"] == 10


@pytest.mark.asyncio
async def test_totp_confirm_with_wrong_code_rejects(client) -> None:  # type: ignore[no-untyped-def]
    _reg, token = await _register_and_login(client, "totp3@example.com")
    setup = await client.post(
        "/api/account/totp/setup",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert setup.status_code == 201
    bad = await client.post(
        "/api/account/totp/confirm",
        json={"code": "000000"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert bad.status_code == 401


@pytest.mark.asyncio
async def test_totp_disable_requires_valid_code(client) -> None:  # type: ignore[no-untyped-def]
    _reg, token = await _register_and_login(client, "totp4@example.com")
    secret, _codes = await _setup_and_confirm_totp(client, token)

    # Wrong code rejected.
    bad = await client.post(
        "/api/account/totp/disable",
        json={"code": "000000"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert bad.status_code == 401

    # Correct current code accepted.
    code = totp.current_code(secret)
    ok = await client.post(
        "/api/account/totp/disable",
        json={"code": code},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert ok.status_code == 204
    status_resp = await client.get(
        "/api/account/totp/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert status_resp.json()["enabled"] is False


# ---------------------------------------------------------------------------
# Two-step login flow
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_returns_otp_challenge_when_2fa_enabled(client) -> None:  # type: ignore[no-untyped-def]
    reg, token = await _register_and_login(client, "twostep1@example.com")
    await _setup_and_confirm_totp(client, token)

    resp = await client.post(
        "/api/sessions",
        json={"email": reg["email"], "auth_key": reg["auth_key"]},
    )
    # Login responds 201 — it's still a "success" — but with the challenge shape.
    assert resp.status_code == 201
    body = resp.json()
    assert body.get("requires_otp") is True
    assert body["otp_token"]
    assert body["otp_expires_in"] > 0
    # The full token-pair fields must NOT be present yet.
    assert "access_token" not in body


@pytest.mark.asyncio
async def test_login_otp_with_valid_code_returns_token_pair(client) -> None:  # type: ignore[no-untyped-def]
    reg, token = await _register_and_login(client, "twostep2@example.com")
    secret, _codes = await _setup_and_confirm_totp(client, token)

    challenge_resp = await client.post(
        "/api/sessions",
        json={"email": reg["email"], "auth_key": reg["auth_key"]},
    )
    otp_token = challenge_resp.json()["otp_token"]

    code = totp.current_code(secret)
    resp = await client.post(
        "/api/sessions/otp",
        json={"otp_token": otp_token, "code": code},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["encrypted_symmetric_key"]


@pytest.mark.asyncio
async def test_login_otp_with_wrong_code_rejects(client) -> None:  # type: ignore[no-untyped-def]
    reg, token = await _register_and_login(client, "twostep3@example.com")
    await _setup_and_confirm_totp(client, token)

    challenge = await client.post(
        "/api/sessions",
        json={"email": reg["email"], "auth_key": reg["auth_key"]},
    )
    otp_token = challenge.json()["otp_token"]

    resp = await client.post(
        "/api/sessions/otp",
        json={"otp_token": otp_token, "code": "000000"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_otp_with_recovery_code_succeeds_and_consumes(client) -> None:  # type: ignore[no-untyped-def]
    reg, token = await _register_and_login(client, "twostep4@example.com")
    _secret, codes = await _setup_and_confirm_totp(client, token)
    one_code = codes[0]

    challenge = await client.post(
        "/api/sessions",
        json={"email": reg["email"], "auth_key": reg["auth_key"]},
    )
    otp_token = challenge.json()["otp_token"]

    ok = await client.post(
        "/api/sessions/otp",
        json={"otp_token": otp_token, "code": one_code},
    )
    assert ok.status_code == 201, ok.text

    # Recovery codes are single-use — second attempt with the same code fails.
    challenge2 = await client.post(
        "/api/sessions",
        json={"email": reg["email"], "auth_key": reg["auth_key"]},
    )
    otp_token2 = challenge2.json()["otp_token"]
    reused = await client.post(
        "/api/sessions/otp",
        json={"otp_token": otp_token2, "code": one_code},
    )
    assert reused.status_code == 401

    # Status reflects that one was used.
    status_resp = await client.get(
        "/api/account/totp/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert status_resp.json()["recovery_codes_remaining"] == 9


@pytest.mark.asyncio
async def test_login_otp_with_bad_token_rejects(client) -> None:  # type: ignore[no-untyped-def]
    resp = await client.post(
        "/api/sessions/otp",
        json={"otp_token": "not-a-jwt", "code": "123456"},
    )
    assert resp.status_code == 401
