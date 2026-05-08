"""Pydantic schemas — API request/response contracts.

These define the wire format. They DO NOT define the encrypted plaintext
schemas, which are the client's concern.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

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
    email: EmailStr
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
    email: EmailStr
    auth_key: str = Field(min_length=32, max_length=512)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 — OAuth2 token type, not a secret
    access_expires_in: int
    refresh_expires_in: int
    encrypted_symmetric_key: str


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
