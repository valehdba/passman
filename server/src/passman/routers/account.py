"""Per-account settings endpoints.

Distinct from `accounts.py` (registration + pre-login KDF lookup):
this router holds endpoints that act on the *currently signed-in*
user. v1 contents: TOTP / 2FA management.

Threat-model note for the TOTP endpoints
----------------------------------------
RFC 6238 verification requires the verifier to know the shared secret,
so enabling 2FA puts a per-user OTP secret on the server. Vault
contents stay zero-knowledge — those are still encrypted with the
master key the server never sees — but login auth widens by one
secret. Disabling 2FA requires a current OTP code (or recovery code),
so a stolen access token alone can't downgrade the auth posture.
"""

from __future__ import annotations

import json
from typing import cast

from fastapi import APIRouter, status

from ..config import get_settings
from ..deps import CurrentUserDep, SessionDep
from ..errors import InvalidCredentialsError
from ..schemas import (
    TotpConfirmRequest,
    TotpConfirmResponse,
    TotpDisableRequest,
    TotpSetupResponse,
    TotpStatusResponse,
)
from ..totp import (
    build_provisioning_uri,
    consume_recovery_code,
    generate_recovery_codes,
    generate_secret,
    hash_recovery_codes,
    verify,
)

router = APIRouter(prefix="/api/account", tags=["account"])


def _issuer_for_provisioning() -> str:
    """The issuer string embedded in `otpauth://...` URIs.

    Showing the deployment hostname (when set) helps users distinguish
    "Passman (work)" from "Passman (personal)" in their authenticator
    app's list. Falls back to the literal "Passman" when no host is
    configured (e.g. in dev).
    """
    settings = get_settings()
    # `cors_origins` is the closest stable signal we have for "what URL
    # do my users actually see?". Take the first https origin.
    for origin in settings.cors_origins:
        if origin.startswith("https://"):
            return f"Passman ({origin.removeprefix('https://')})"
    return "Passman"


@router.get("/totp/status", response_model=TotpStatusResponse)
async def totp_status(user: CurrentUserDep) -> TotpStatusResponse:
    """Whether 2FA is enabled + how many recovery codes are left."""
    remaining = 0
    if user.totp_enabled and user.totp_recovery_hashes:
        try:
            remaining = len(json.loads(user.totp_recovery_hashes))
        except (ValueError, TypeError):
            remaining = 0
    return TotpStatusResponse(enabled=user.totp_enabled, recovery_codes_remaining=remaining)


@router.post(
    "/totp/setup",
    response_model=TotpSetupResponse,
    status_code=status.HTTP_201_CREATED,
)
async def totp_setup(user: CurrentUserDep, session: SessionDep) -> TotpSetupResponse:
    """Generate a fresh provisional TOTP secret + QR provisioning URI.

    Idempotent: calling this on a user who already started but didn't
    finish setup overwrites the provisional secret. Calling it on a
    user who has fully enabled 2FA is rejected with 400 — they must
    disable first.
    """
    if user.totp_enabled:
        raise InvalidCredentialsError("2FA is already enabled — disable it first to re-enrol")

    secret = generate_secret()
    user.totp_secret = secret
    # Keep `totp_enabled` false until the user confirms with a code.
    await session.flush()

    return TotpSetupResponse(
        provisioning_uri=build_provisioning_uri(
            secret, account=user.email, issuer=_issuer_for_provisioning()
        ),
        secret_base32=__import__("base64").b32encode(secret).decode("ascii").rstrip("="),
    )


@router.post(
    "/totp/confirm",
    response_model=TotpConfirmResponse,
)
async def totp_confirm(
    payload: TotpConfirmRequest, user: CurrentUserDep, session: SessionDep
) -> TotpConfirmResponse:
    """Confirm setup by submitting a code from the user's authenticator.

    On success, flips `totp_enabled` to true and returns the plaintext
    recovery codes — they're shown to the user exactly once. The server
    persists only the Argon2id-hashed list.
    """
    if user.totp_enabled:
        raise InvalidCredentialsError("2FA already enabled")
    if user.totp_secret is None:
        raise InvalidCredentialsError("Call /totp/setup first")
    if not verify(user.totp_secret, payload.code):
        raise InvalidCredentialsError("Invalid OTP code")

    codes = generate_recovery_codes()
    user.totp_recovery_hashes = hash_recovery_codes(codes)
    user.totp_enabled = True
    await session.flush()

    return TotpConfirmResponse(recovery_codes=codes)


@router.post("/totp/disable", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def totp_disable(
    payload: TotpDisableRequest, user: CurrentUserDep, session: SessionDep
) -> None:
    """Disable 2FA. Requires a current OTP code OR a recovery code so a
    stolen access token alone can't downgrade the auth posture."""
    if not user.totp_enabled:
        return  # idempotent: already disabled

    secret = user.totp_secret
    valid = False
    if secret is not None and verify(secret, payload.code):
        valid = True
    elif user.totp_recovery_hashes:
        matched, _remaining = consume_recovery_code(user.totp_recovery_hashes, payload.code)
        valid = matched

    if not valid:
        raise InvalidCredentialsError("Invalid OTP or recovery code")

    user.totp_secret = None
    user.totp_enabled = False
    user.totp_recovery_hashes = None
    await session.flush()


# Re-export so tests can import without round-tripping through this module.
__all__ = ["router", "_issuer_for_provisioning", cast(str, "totp_status")]
