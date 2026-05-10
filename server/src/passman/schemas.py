"""Pydantic schemas — API request/response contracts.

These define the wire format. They DO NOT define the encrypted plaintext
schemas, which are the client's concern.

Email handling
--------------
All email-bearing requests use :data:`NormalizedEmail`, an Annotated alias
that strips whitespace and lowercases the address before any further
validation. Centralizing this here means every router compares apples to
apples — no router needs to remember to call ``.lower()``.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, EmailStr, Field, StringConstraints


def _normalize_email(value: object) -> object:
    """Strip + lowercase. Pass non-strings through to let EmailStr raise its own error."""
    if isinstance(value, str):
        return value.strip().lower()
    return value


NormalizedEmail = Annotated[EmailStr, BeforeValidator(_normalize_email)]


# -- Reusable ----------------------------------------------------------------

# Encrypted blob format: "v1:<base64 IV (12 bytes)>:<base64 ciphertext+tag>"
EncryptedBlob = Annotated[
    str,
    StringConstraints(
        pattern=r"^v\d+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$",
        min_length=8,
        max_length=64 * 1024,  # 64 KiB ciphertext cap per item
    ),
]

ItemType = Literal["login", "note", "card", "identity"]


class _ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# -- Account / KDF -----------------------------------------------------------


class KdfParams(BaseModel):
    """Client-side KDF parameters required to re-derive the master key on login."""

    kdf_salt: str = Field(min_length=8, max_length=64)
    kdf_time_cost: int = Field(ge=2, le=10)
    kdf_memory_cost: int = Field(ge=19_456, le=1_048_576)  # 19 MiB .. 1 GiB
    kdf_parallelism: int = Field(ge=1, le=16)


class RegisterRequest(KdfParams):
    email: NormalizedEmail
    auth_key: str = Field(
        min_length=32, max_length=512, description="Base64 client-derived auth key"
    )
    encrypted_symmetric_key: EncryptedBlob


class RegisterResponse(BaseModel):
    user_id: uuid.UUID
    email: EmailStr


# -- Sessions / Login --------------------------------------------------------


class KdfLookupResponse(KdfParams):
    """Returned to clients pre-login so they can derive the master key."""


class LoginRequest(BaseModel):
    email: NormalizedEmail
    auth_key: str = Field(min_length=32, max_length=512)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 — OAuth2 token type, not a secret
    access_expires_in: int
    refresh_expires_in: int
    encrypted_symmetric_key: str


class OtpChallengeResponse(BaseModel):
    """Returned by ``POST /sessions`` when the user has 2FA enabled.

    The client treats this as the signal to prompt for an authenticator
    code, then POSTs to ``/sessions/otp`` with the same `otp_token` plus
    the 6-digit code (or a recovery code).
    """

    requires_otp: Literal[True] = True
    otp_token: str
    otp_expires_in: int


class OtpLoginRequest(BaseModel):
    otp_token: str
    # Allow both 6-digit codes and recovery codes (length up to 9 with the
    # `xxxx-xxxx` formatting). Pydantic v2 lets us narrow further at runtime.
    code: str = Field(min_length=4, max_length=32)


# -- TOTP / 2FA management (all require an authenticated session) ---------


class TotpSetupResponse(BaseModel):
    """Returned by ``POST /account/totp/setup`` — the data the client needs
    to render a QR code (`provisioning_uri`) and offer a manual fallback
    (`secret_base32`). The secret is provisional until the user confirms
    by submitting a valid code."""

    provisioning_uri: str
    secret_base32: str


class TotpConfirmRequest(BaseModel):
    code: str = Field(min_length=4, max_length=10)


class TotpConfirmResponse(BaseModel):
    """The plaintext recovery codes are returned exactly once. The server
    persists only their Argon2id hashes."""

    recovery_codes: list[str]


class TotpDisableRequest(BaseModel):
    """Disabling 2FA requires either a current OTP code or a recovery code,
    so a stolen access token alone can't downgrade the auth posture."""

    code: str = Field(min_length=4, max_length=32)


class TotpStatusResponse(BaseModel):
    enabled: bool
    recovery_codes_remaining: int


class RefreshRequest(BaseModel):
    refresh_token: str


class RefreshResponse(BaseModel):
    access_token: str
    access_expires_in: int
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 — OAuth2 token type, not a secret


# -- Vault -------------------------------------------------------------------


class VaultItemCreate(BaseModel):
    item_type: ItemType = "login"
    encrypted_data: EncryptedBlob


class VaultItemUpdate(BaseModel):
    item_type: ItemType | None = None
    encrypted_data: EncryptedBlob | None = None


class VaultItemOut(_ORMModel):
    id: uuid.UUID
    item_type: str
    encrypted_data: str
    created_at: datetime
    updated_at: datetime


class VaultListResponse(BaseModel):
    items: list[VaultItemOut]


# -- Generic -----------------------------------------------------------------


class ErrorResponse(BaseModel):
    detail: str
