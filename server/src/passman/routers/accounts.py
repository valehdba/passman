"""Account endpoints: registration and pre-login KDF parameter lookup.

`/kdf?email=...` is intentionally rate-limited and returns deterministic
no-op parameters for non-existent users — this prevents email enumeration
via timing or response-shape differences.
"""
from __future__ import annotations

import hashlib
import hmac

from fastapi import APIRouter, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..auth import hash_auth_key
from ..config import get_settings
from ..deps import SessionDep
from ..errors import EmailAlreadyRegisteredError
from ..models import User
from ..schemas import KdfLookupResponse, RegisterRequest, RegisterResponse

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(payload: RegisterRequest, session: SessionDep) -> RegisterResponse:
    """Create a new account.

    The client has already:
      1. Generated a random `kdf_salt` and `symmetric_key`.
      2. Derived `master_key = Argon2id(password, kdf_salt, params)`.
      3. Derived `auth_key` from master_key (one-way).
      4. Encrypted the symmetric_key with the master_key.

    The server stores: email, kdf_params (so login can re-derive), the
    *hash* of auth_key, and the encrypted symmetric_key blob.
    """
    user = User(
        email=payload.email.lower(),
        kdf_salt=payload.kdf_salt,
        kdf_time_cost=payload.kdf_time_cost,
        kdf_memory_cost=payload.kdf_memory_cost,
        kdf_parallelism=payload.kdf_parallelism,
        auth_hash=hash_auth_key(payload.auth_key),
        encrypted_symmetric_key=payload.encrypted_symmetric_key,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise EmailAlreadyRegisteredError() from exc

    return RegisterResponse(user_id=user.id, email=user.email)


@router.get("/kdf", response_model=KdfLookupResponse)
async def kdf_lookup(
    session: SessionDep,
    email: str = Query(..., min_length=3, max_length=255),
) -> KdfLookupResponse:
    """Return KDF params for an email so the client can derive its master key.

    Returns *plausible* deterministic params for unknown emails to prevent
    enumeration. The salt for unknown users is HMAC(email, server_secret) —
    stable per email but indistinguishable from a real salt.
    """
    settings = get_settings()
    normalized = email.strip().lower()

    user = (
        await session.execute(select(User).where(User.email == normalized))
    ).scalar_one_or_none()
    if user is not None:
        return KdfLookupResponse(
            kdf_salt=user.kdf_salt,
            kdf_time_cost=user.kdf_time_cost,
            kdf_memory_cost=user.kdf_memory_cost,
            kdf_parallelism=user.kdf_parallelism,
        )

    # Deterministic synthetic salt — hex-encoded HMAC of email keyed with JWT secret.
    decoy_salt = hmac.new(
        settings.jwt_secret.get_secret_value().encode("utf-8"),
        normalized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:32]
    return KdfLookupResponse(
        kdf_salt=decoy_salt,
        kdf_time_cost=settings.client_argon2_time_cost,
        kdf_memory_cost=settings.client_argon2_memory_cost,
        kdf_parallelism=settings.client_argon2_parallelism,
    )
