"""Trusted-device ("skip OTP on this browser") helpers.

Threat model: the token only lets a holder skip the *second* factor, and only
after the correct master-password-derived ``auth_key`` has been presented. It
is a 256-bit random value, stored server-side as SHA-256 only, scoped to one
user, expires at a fixed time (no sliding renewal), and is revoked when 2FA is
disabled or the user revokes it. Presenting a bad/expired token is
indistinguishable from presenting none (the normal OTP prompt appears).
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .models import TrustedDevice


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def hash_device_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def clamp_days(requested: int | None) -> int:
    s = get_settings()
    days = requested if requested is not None else s.trusted_device_default_days
    return max(1, min(days, s.trusted_device_max_days))


async def create_trusted_device(
    session: AsyncSession, user_id: uuid.UUID, days: int | None, user_agent: str | None
) -> tuple[str, int]:
    """Create a trust record. Returns ``(raw_token, ttl_seconds)``."""
    ttl_days = clamp_days(days)
    now = _utcnow()

    # Housekeeping: drop expired rows, then evict the oldest beyond the cap.
    await session.execute(
        delete(TrustedDevice).where(
            TrustedDevice.user_id == user_id, TrustedDevice.expires_at <= now
        )
    )
    cap = get_settings().trusted_device_max_per_user
    existing = (
        (
            await session.execute(
                select(TrustedDevice)
                .where(TrustedDevice.user_id == user_id)
                .order_by(TrustedDevice.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    for old in existing[: max(0, len(existing) - cap + 1)]:
        await session.delete(old)

    raw = secrets.token_urlsafe(32)  # 256 bits
    session.add(
        TrustedDevice(
            user_id=user_id,
            token_hash=hash_device_token(raw),
            expires_at=now + timedelta(days=ttl_days),
            user_agent=(user_agent or "")[:255] or None,
        )
    )
    await session.flush()
    return raw, ttl_days * 86400


async def is_trusted(session: AsyncSession, user_id: uuid.UUID, raw_token: str | None) -> bool:
    """True if ``raw_token`` is a live trust token belonging to ``user_id``."""
    if not raw_token:
        return False
    dev = (
        await session.execute(
            select(TrustedDevice).where(
                TrustedDevice.token_hash == hash_device_token(raw_token),
                TrustedDevice.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if dev is None or _aware(dev.expires_at) <= _utcnow():
        return False
    dev.last_used_at = _utcnow()
    await session.flush()
    return True


async def revoke_all(session: AsyncSession, user_id: uuid.UUID) -> None:
    await session.execute(delete(TrustedDevice).where(TrustedDevice.user_id == user_id))
