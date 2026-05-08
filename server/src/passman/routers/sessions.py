"""Session endpoints — login, refresh, logout."""

from __future__ import annotations

import logging
from contextlib import suppress
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Header, status
from sqlalchemy import select
from sqlalchemy.exc import NoResultFound

from ..auth import (
    auth_hash_needs_rehash,
    create_access_token,
    generate_refresh_token,
    hash_auth_key,
    hash_refresh_token,
    verify_auth_key,
    verify_dummy_auth_key,
)
from ..deps import CurrentUserDep, SessionDep
from ..errors import InvalidCredentialsError, InvalidTokenError
from ..models import Session as SessionModel
from ..models import User
from ..schemas import LoginRequest, RefreshRequest, RefreshResponse, TokenPair

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _ensure_aware(dt: datetime) -> datetime:
    """Some dialects (SQLite) drop tzinfo on round-trip. Treat naive as UTC."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


@router.post("", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def login(
    payload: LoginRequest,
    session: SessionDep,
    user_agent: str | None = Header(default=None, alias="User-Agent"),
) -> TokenPair:
    """Verify the auth_key and issue access + refresh tokens.

    The unknown-user branch runs :func:`verify_dummy_auth_key` so the wall-time
    matches the wrong-password branch — closing the timing oracle that would
    otherwise leak whether an email is registered.
    """
    user = (
        await session.execute(select(User).where(User.email == payload.email))
    ).scalar_one_or_none()

    if user is None:
        # Equalize timing using the SAME hasher real users use, so this stays
        # honest even if `server_argon2_*` settings are bumped later.
        verify_dummy_auth_key(payload.auth_key)
        raise InvalidCredentialsError()

    if not verify_auth_key(payload.auth_key, user.auth_hash):
        raise InvalidCredentialsError()

    # Opportunistically upgrade to current Argon2 parameters when the stored
    # hash was produced under a weaker policy. Failure here must not block
    # login — it's a best-effort hygiene step. We log at warning level so
    # repeated failures are visible to operators.
    if auth_hash_needs_rehash(user.auth_hash):
        try:
            user.auth_hash = hash_auth_key(payload.auth_key)
        except Exception:
            # Swallowing here is intentional: a failed rehash must never
            # convert a legitimate login into a 5xx.
            logger.warning("auth_hash rehash failed for user_id=%s", user.id, exc_info=True)

    raw_refresh, refresh_hash, refresh_ttl = generate_refresh_token()
    access_token, access_ttl = create_access_token(str(user.id))

    db_session = SessionModel(
        user_id=user.id,
        refresh_token_hash=refresh_hash,
        expires_at=_utcnow() + timedelta(seconds=refresh_ttl),
        user_agent=(user_agent or "")[:255],
    )
    session.add(db_session)
    await session.flush()

    return TokenPair(
        access_token=access_token,
        refresh_token=raw_refresh,
        access_expires_in=access_ttl,
        refresh_expires_in=refresh_ttl,
        encrypted_symmetric_key=user.encrypted_symmetric_key,
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(payload: RefreshRequest, session: SessionDep) -> RefreshResponse:
    """Exchange a refresh token for a new access token.

    Refresh tokens are reusable until expiry in v1; rotation with reuse
    detection is on the roadmap (see ``docs/SECURITY.md``).
    """
    refresh_hash = hash_refresh_token(payload.refresh_token)
    # Join with User so a refresh token whose owner has been deleted yields 401
    # immediately (defense in depth — ON DELETE CASCADE should already cover this).
    stmt = (
        select(SessionModel, User)
        .join(User, User.id == SessionModel.user_id)
        .where(SessionModel.refresh_token_hash == refresh_hash)
    )
    row = (await session.execute(stmt)).first()
    if row is None:
        raise InvalidTokenError("Refresh token revoked or unknown")

    db_session, user = row
    if db_session.revoked_at is not None:
        raise InvalidTokenError("Refresh token revoked or unknown")
    if _ensure_aware(db_session.expires_at) <= _utcnow():
        raise InvalidTokenError("Refresh token expired")

    access_token, access_ttl = create_access_token(str(user.id))
    return RefreshResponse(access_token=access_token, access_expires_in=access_ttl)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def logout(
    payload: RefreshRequest,
    session: SessionDep,
    user: CurrentUserDep,
) -> None:
    """Revoke a refresh token. Requires a valid access token to prove identity."""
    refresh_hash = hash_refresh_token(payload.refresh_token)
    stmt = select(SessionModel).where(
        SessionModel.refresh_token_hash == refresh_hash,
        SessionModel.user_id == user.id,
    )
    # Idempotent — already-gone is fine, no error returned to the client.
    with suppress(NoResultFound):
        db_session = (await session.execute(stmt)).scalar_one()
        db_session.revoked_at = _utcnow()
