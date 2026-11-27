"""In-browser SSH terminal endpoints (server-side gateway; see ssh_gateway.py)."""

from __future__ import annotations

import contextlib
import logging

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status

from .. import ssh_gateway as gw
from ..deps import CurrentUserDep
from ..schemas import SshConfigResponse, SshTicketRequest, SshTicketResponse

logger = logging.getLogger("passman.ssh")

router = APIRouter(prefix="/api/ssh", tags=["ssh"])


@router.get("/config", response_model=SshConfigResponse)
async def ssh_config(_: CurrentUserDep) -> SshConfigResponse:
    return SshConfigResponse(enabled=gw.gateway_enabled())


@router.post("/tickets", response_model=SshTicketResponse, status_code=status.HTTP_201_CREATED)
async def create_ticket(body: SshTicketRequest, user: CurrentUserDep) -> SshTicketResponse:
    try:
        ip = await gw.resolve_allowed(body.host, body.port)
        ticket = gw.new_ticket(user.id, user.email, body.host, body.port, body.username, ip)
        token = gw.tickets.mint(ticket)
    except gw.GatewayDisabledError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except gw.HostNotAllowedError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except gw.GatewayError as exc:
        code = (
            status.HTTP_429_TOO_MANY_REQUESTS
            if "Too many" in str(exc)
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(code, detail=str(exc)) from exc
    return SshTicketResponse(ticket=token, expires_in=gw.TICKET_TTL_SECONDS)


@router.websocket("/ws")
async def ssh_ws(websocket: WebSocket, ticket: str) -> None:
    t = gw.tickets.consume(ticket)
    if t is None:
        # Reject before accepting the upgrade (HTTP 403 on the handshake).
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    await websocket.accept()
    try:
        await gw.run_session(websocket, t)  # type: ignore[arg-type]
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("ssh session crashed")
    finally:
        with contextlib.suppress(RuntimeError):
            await websocket.close()
