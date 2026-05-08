"""Session endpoints — login, refresh, logout."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Header, status
from sqlalchemy import select
from sqlalchemy.exc import NoResultFound

from ..auth import (
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
    verify_auth_key,
)
from ..deps import CurrentUserDep, SessionDep
from ..errors import InvalidCredentialsError, InvalidTokenError
from ..models import Session as SessionModel
from ..models import User
from ..schemas import LoginRequest, RefreshRequest, RefreshResponse, TokenPair

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

    The error path uses constant work via a dummy verification when the user
    does not exist, to avoid exposing user existence via timing.
    """
    user = (
        await session.execute(select(User).where(User.email == payload.email.lower()))
    ).scalar_one_or_none()

    if user is None:
        # Dummy verify so timing is comparable to the real path.
        verify_auth_key(payload.auth_key, "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")  # noqa: E501
        raise InvalidCredentialsError()

    if not verify_auth_key(payload.auth_key, user.auth_hash):
        raise InvalidCredentialsError()

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

    Refresh tokens are single-use? In v1 we keep them reusable until expiry
    — simpler. Rotating with reuse-detection is a future hardening step.
    """
    refresh_hash = hash_refresh_token(payload.refresh_token)
    stmt = select(SessionModel).where(SessionModel.refresh_token_hash == refresh_hash)
    db_session = (await session.execute(stmt)).scalar_one_or_none()

    if db_session is None or db_session.revoked_at is not None:
        raise InvalidTokenError("Refresh token revoked or unknown")
    if _ensure_aware(db_session.expires_at) <= _utcnow():
        raise InvalidTokenError("Refresh token expired")

    access_token, access_ttl = create_access_token(str(db_session.user_id))
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
    try:
        db_session = (await session.execute(stmt)).scalar_one()
    except NoResultFound:
        # Idempotent — already gone is fine.
        return
    db_session.revoked_at = _utcnow()
