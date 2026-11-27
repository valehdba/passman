"""Admin-only endpoints: change the server's database from the UI.

Only the account whose email equals ``ADMIN_EMAIL`` may use these. Everyone
else (and every deployment that leaves ``ADMIN_EMAIL`` empty) gets 403.

Switching never touches the previous database: it tests the target, migrates
*the target*, saves the connection encrypted on the settings volume, and swaps
the live engine. Existing users/vault items stay in the old database.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from .. import db_admin
from ..config import get_settings
from ..deps import CurrentUserDep
from ..models import User
from ..schemas import DbCheckResponse, DbConnectionIn, DbStatusResponse, DbSwitchRequest

logger = logging.getLogger("passman.admin")

router = APIRouter(prefix="/api/admin/database", tags=["admin"])


async def require_admin(user: CurrentUserDep) -> User:
    admin = get_settings().admin_email.strip().lower()
    if not admin or user.email.strip().lower() != admin:
        # 403 for both "not you" and "feature disabled": no reason to
        # advertise which of the two it is.
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Admin only")
    return user


AdminDep = Annotated[User, Depends(require_admin)]


def _to_conn(body: DbConnectionIn) -> db_admin.DbConnection:
    return db_admin.DbConnection(
        host=body.host,
        port=body.port,
        database=body.database,
        username=body.username,
        password=body.password.get_secret_value(),
        sslmode=body.sslmode,
    )


@router.get("", response_model=DbStatusResponse)
async def get_status(_: AdminDep) -> DbStatusResponse:
    return DbStatusResponse(source=db_admin.active_source(), current=db_admin.active_description())


@router.post("/test", response_model=DbCheckResponse)
async def test_connection(body: DbConnectionIn, _: AdminDep) -> DbCheckResponse:
    res = await db_admin.check_connection(_to_conn(body))
    return DbCheckResponse(
        ok=res.ok,
        server_version=res.server_version,
        schema_state=res.schema_state,
        error=res.error,
    )


@router.put("", response_model=DbStatusResponse)
async def switch_database(body: DbSwitchRequest, admin: AdminDep) -> DbStatusResponse:
    if not body.confirm:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Confirmation required: switching affects every user of this server",
        )
    conn = _to_conn(body)
    res = await db_admin.check_connection(conn)
    if not res.ok:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail=res.error or "Connection check failed"
        )
    try:
        await db_admin.apply_connection(conn)
    except Exception as exc:
        logger.exception("database switch failed")
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=db_admin.scrub(
                f"Switch failed, nothing was changed: {type(exc).__name__}: {exc}", conn.password
            ),
        ) from exc
    logger.warning(
        "admin %s switched database to %s:%s/%s", admin.email, conn.host, conn.port, conn.database
    )
    return DbStatusResponse(source=db_admin.active_source(), current=db_admin.active_description())


@router.delete("", response_model=DbStatusResponse)
async def reset_database(admin: AdminDep) -> DbStatusResponse:
    await db_admin.reset_to_environment()
    logger.warning("admin %s reset database to the DATABASE_URL default", admin.email)
    return DbStatusResponse(source=db_admin.active_source(), current=db_admin.active_description())
