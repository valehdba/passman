"""Authentication primitives.

This module is the single place where:
- the client-derived `auth_key` is hashed (Argon2id) for storage / verification,
- access tokens (JWT) are minted and verified,
- refresh tokens are generated, hashed (SHA-256), and verified.

We intentionally hash refresh tokens before storage so a DB read does not
yield a usable token. Hashes are SHA-256, not Argon2: refresh tokens have
high entropy (32 random bytes) so brute-forcing the hash is computationally
infeasible regardless of hash speed, and SHA-256 lets us look them up in O(1).
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from argon2 import PasswordHasher
from argon2 import exceptions as argon2_exc
from jose import JWTError, jwt

from .config import get_settings

# Server-side hasher with parameters from settings (RFC 9106 minimum + room).
_settings = get_settings()
_password_hasher = PasswordHasher(
    time_cost=_settings.server_argon2_time_cost,
    memory_cost=_settings.server_argon2_memory_cost,
    parallelism=_settings.server_argon2_parallelism,
)


# ---------------------------------------------------------------------------
# auth_key hashing (the client-side stretched value)
# ---------------------------------------------------------------------------


def hash_auth_key(auth_key: str) -> str:
    """Hash the client-derived auth_key with Argon2id for storage."""
    return _password_hasher.hash(auth_key)


def verify_auth_key(auth_key: str, stored_hash: str) -> bool:
    """Constant-time verification. Returns False on any mismatch or error."""
    try:
        _password_hasher.verify(stored_hash, auth_key)
    except (argon2_exc.VerifyMismatchError, argon2_exc.InvalidHashError, argon2_exc.VerificationError):  # noqa: E501
        return False
    return True


def auth_hash_needs_rehash(stored_hash: str) -> bool:
    """True if hash params are below current policy and should be upgraded."""
    return _password_hasher.check_needs_rehash(stored_hash)


# ---------------------------------------------------------------------------
# JWT access tokens
# ---------------------------------------------------------------------------


def _utcnow() -> datetime:
    return datetime.now(UTC)


def create_access_token(
    subject: str, *, extra_claims: dict[str, Any] | None = None
) -> tuple[str, int]:
    """Return (token, ttl_seconds)."""
    settings = get_settings()
    ttl = settings.access_token_ttl_seconds
    now = _utcnow()
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl)).timestamp()),
        "jti": secrets.token_urlsafe(16),  # unique per-token id
        "type": "access",
    }
    if extra_claims:
        payload.update(extra_claims)
    token = jwt.encode(
        payload, settings.jwt_secret.get_secret_value(), algorithm=settings.jwt_algorithm
    )
    return token, ttl


def decode_access_token(token: str) -> dict[str, Any]:
    """Raise JWTError on invalid/expired tokens. Caller maps to 401."""
    settings = get_settings()
    payload = jwt.decode(
        token,
        settings.jwt_secret.get_secret_value(),
        algorithms=[settings.jwt_algorithm],
    )
    if payload.get("type") != "access":
        raise JWTError("Invalid token type")
    return payload


# ---------------------------------------------------------------------------
# Refresh tokens (opaque random string + SHA-256 stored)
# ---------------------------------------------------------------------------


def generate_refresh_token() -> tuple[str, str, int]:
    """Returns (raw_token, sha256_hex, ttl_seconds).

    The raw token is sent to the client exactly once. The hex hash is stored.
    """
    raw = secrets.token_urlsafe(48)  # 48 bytes -> 64 chars; ~384 bits of entropy
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return raw, digest, get_settings().refresh_token_ttl_seconds


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    """For comparing tokens — wrapper for clarity."""
    return hmac.compare_digest(a, b)
