"""Authentication primitives.

This module is the single place where:
- the client-derived ``auth_key`` is hashed (Argon2id) for storage / verification,
- access tokens (JWT) are minted and verified,
- refresh tokens are generated, hashed (SHA-256), and verified.

We intentionally hash refresh tokens before storage so a DB read does not
yield a usable token. Hashes are SHA-256, not Argon2: refresh tokens have
high entropy (~384 bits) so brute-forcing the hash is computationally
infeasible regardless of hash speed, and SHA-256 lets us look them up in O(1).

Timing-attack hardening
-----------------------
The login path uses :func:`verify_dummy_auth_key` for the unknown-user case.
The dummy hash is generated **at first use, with the same hasher that handles
real users**, so any future bump to ``server_argon2_*`` parameters keeps the
unknown-user and wrong-password code paths in lockstep — closing the timing
oracle that would otherwise let an attacker enumerate registered emails.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any

from argon2 import PasswordHasher
from argon2 import exceptions as argon2_exc
from jose import JWTError, jwt

from .config import get_settings

# A non-secret constant used to seed the dummy hash. Its value never matters —
# only that the resulting PHC string parses cleanly under the hasher's current
# parameters and that ``verify`` runs the full Argon2id work for it.
_DUMMY_AUTH_KEY = "dummy-auth-key-for-timing-equalization"


# ---------------------------------------------------------------------------
# Hasher — lazily constructed so test fixtures and runtime settings overrides
# are honored. Cached after first use because Argon2 setup is non-trivial.
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _password_hasher() -> PasswordHasher:
    """Return the singleton Argon2id hasher built from current settings."""
    settings = get_settings()
    return PasswordHasher(
        time_cost=settings.server_argon2_time_cost,
        memory_cost=settings.server_argon2_memory_cost,
        parallelism=settings.server_argon2_parallelism,
    )


@lru_cache(maxsize=1)
def _dummy_auth_hash() -> str:
    """Generate (and cache) a dummy Argon2id hash under the *current* hasher.

    Regenerated together with :func:`_password_hasher` if either is reset
    via :func:`reset_auth_caches` (used in tests).
    """
    return _password_hasher().hash(_DUMMY_AUTH_KEY)


def reset_auth_caches() -> None:
    """Clear cached hasher and dummy hash. Intended for tests after settings change."""
    _password_hasher.cache_clear()
    _dummy_auth_hash.cache_clear()


# ---------------------------------------------------------------------------
# auth_key hashing (the client-side stretched value)
# ---------------------------------------------------------------------------


def hash_auth_key(auth_key: str) -> str:
    """Hash the client-derived auth_key with Argon2id for storage."""
    return _password_hasher().hash(auth_key)


def verify_auth_key(auth_key: str, stored_hash: str) -> bool:
    """Verify ``auth_key`` against ``stored_hash``. Returns False on any failure.

    Argon2 internals run in constant time for inputs of equal length; this
    function additionally swallows the structured exceptions so callers do
    not need to distinguish between mismatch and malformed-hash cases.
    """
    try:
        _password_hasher().verify(stored_hash, auth_key)
    except (
        argon2_exc.VerifyMismatchError,
        argon2_exc.InvalidHashError,
        argon2_exc.VerificationError,
    ):
        return False
    return True


def verify_dummy_auth_key(auth_key: str) -> None:
    """Run a verify against a dummy hash to equalize unknown-user timing.

    Always returns ``None`` — the side effect (CPU / memory work) is the
    entire point. Uses the same hasher as real users, so unknown-user and
    wrong-password paths cost the same wall-time even if server Argon2
    parameters are upgraded.
    """
    try:
        _password_hasher().verify(_dummy_auth_hash(), auth_key)
    except (
        argon2_exc.VerifyMismatchError,
        argon2_exc.InvalidHashError,
        argon2_exc.VerificationError,
    ):
        return


def auth_hash_needs_rehash(stored_hash: str) -> bool:
    """Return True if the hash was produced with parameters weaker than current policy."""
    return _password_hasher().check_needs_rehash(stored_hash)


# ---------------------------------------------------------------------------
# JWT access tokens
# ---------------------------------------------------------------------------


def _utcnow() -> datetime:
    return datetime.now(UTC)


def create_access_token(
    subject: str, *, extra_claims: dict[str, Any] | None = None
) -> tuple[str, int]:
    """Return ``(token, ttl_seconds)``."""
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
    """Raise :class:`JWTError` on invalid/expired tokens. Caller maps to 401."""
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
    """Return ``(raw_token, sha256_hex, ttl_seconds)``.

    The raw token is sent to the client exactly once. The hex hash is stored.
    """
    raw = secrets.token_urlsafe(48)  # 48 bytes -> 64 chars; ~384 bits of entropy
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return raw, digest, get_settings().refresh_token_ttl_seconds


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    """Constant-time string comparison — thin wrapper for clarity at call sites."""
    return hmac.compare_digest(a, b)
