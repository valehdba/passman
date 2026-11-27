"""Server-side SSH gateway for the in-browser terminal.

Security model (read before changing anything here)
---------------------------------------------------
* A gateway lets a logged-in user make *this server* open TCP connections, so it
  is **deny by default**: ``SSH_ALLOWED_HOSTS`` must list every reachable target.
  Empty list = feature disabled. Allowlisted hostnames are resolved and the
  connection is made to the IP we validated (no second DNS lookup).
* Authorization to connect is a single-use, 30-second **ticket** bound to the
  user and the exact host/port/username, minted over the authenticated HTTP API.
  Browsers cannot set headers on WebSockets, and we never put credentials in a
  URL.
* The decrypted password / private key arrives in the first WebSocket frame
  (TLS in production), is used for exactly one SSH login, is held in memory only
  and is never logged or stored. This is the one place the server sees an SSH
  secret; that is inherent to a server-side gateway.
* Host keys are pinned on first use (``<data_dir>/ssh_known_hosts.json``). A
  changed key aborts the connection *before* any credential is sent.
* Per-user caps on tickets/minute and concurrent sessions, an idle timeout, and
  an audit log line per session (user, target, duration; never secrets).
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import json
import logging
import os
import secrets
import socket
import tempfile
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, cast

import asyncssh

from .config import get_settings

logger = logging.getLogger("passman.ssh")

TICKET_TTL_SECONDS = 30
INIT_FRAME_TIMEOUT_SECONDS = 10
MAX_INPUT_FRAME_BYTES = 1 << 20


class GatewayError(Exception):
    """A user-presentable gateway failure (never contains secrets)."""


class GatewayDisabledError(GatewayError):
    pass


class HostNotAllowedError(GatewayError):
    pass


# ----------------------------------------------------------------- allowlist


def _net(entry: str) -> ipaddress.IPv4Network | ipaddress.IPv6Network | None:
    try:
        return ipaddress.ip_network(entry.strip(), strict=False)
    except ValueError:
        return None


def _name_matches(entry: str, host: str) -> bool:
    e = entry.strip().lower().rstrip(".")
    h = host.lower().rstrip(".")
    if e.startswith("*."):
        return h.endswith(e[1:]) and h != e[2:]
    return e == h


def gateway_enabled() -> bool:
    return bool(get_settings().ssh_allowed_hosts)


async def _resolve(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise GatewayError(f"Cannot resolve host: {host}") from exc
    seen: list[str] = []
    for info in infos:
        ip = str(info[4][0])
        if ip not in seen:
            seen.append(ip)
    return seen


async def resolve_allowed(host: str, port: int) -> str:
    """Return the IP to connect to, or raise if ``host`` is not allowlisted."""
    entries = get_settings().ssh_allowed_hosts
    if not entries:
        raise GatewayDisabledError("SSH terminal is disabled on this server")

    nets = [n for e in entries if (n := _net(e)) is not None]

    def in_nets(ip: str) -> bool:
        a = ipaddress.ip_address(ip)
        return any(a in n for n in nets if n.version == a.version)

    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None

    if literal is not None:
        if in_nets(str(literal)):
            return str(literal)
        raise HostNotAllowedError("Host is not in the SSH allowlist")

    ips = await _resolve(host, port)
    if not ips:
        raise GatewayError(f"Cannot resolve host: {host}")
    if any(_name_matches(e, host) for e in entries):
        return ips[0]
    if all(in_nets(ip) for ip in ips):
        return ips[0]
    raise HostNotAllowedError("Host is not in the SSH allowlist")


# ------------------------------------------------------------------- tickets


@dataclass(frozen=True)
class Ticket:
    user_id: uuid.UUID
    email: str
    host: str
    port: int
    username: str
    ip: str
    expires_at: float


class TicketStore:
    """In-memory, single-process. (Run uvicorn with one worker or add sticky routing.)"""

    def __init__(self) -> None:
        self._tickets: dict[str, Ticket] = {}
        self._minted: dict[uuid.UUID, deque[float]] = defaultdict(deque)

    def _gc(self, now: float) -> None:
        for k in [k for k, t in self._tickets.items() if t.expires_at <= now]:
            del self._tickets[k]

    def mint(self, t: Ticket, now: float | None = None) -> str:
        now = time.monotonic() if now is None else now
        self._gc(now)
        recent = self._minted[t.user_id]
        while recent and recent[0] <= now - 60:
            recent.popleft()
        if len(recent) >= get_settings().ssh_tickets_per_minute:
            raise GatewayError("Too many terminal requests; wait a minute")
        recent.append(now)
        token = secrets.token_urlsafe(32)
        self._tickets[token] = t
        return token

    def consume(self, token: str, now: float | None = None) -> Ticket | None:
        now = time.monotonic() if now is None else now
        t = self._tickets.pop(token, None)  # pop: strictly single use
        if t is None or t.expires_at <= now:
            return None
        return t


tickets = TicketStore()
_active: dict[uuid.UUID, int] = defaultdict(int)


def new_ticket(
    user_id: uuid.UUID, email: str, host: str, port: int, username: str, ip: str
) -> Ticket:
    return Ticket(user_id, email, host, port, username, ip, time.monotonic() + TICKET_TTL_SECONDS)


# --------------------------------------------------------- host key pinning


def _known_hosts_path() -> Path:
    return Path(get_settings().data_dir) / "ssh_known_hosts.json"


def _load_known() -> dict[str, str]:
    try:
        data = json.loads(_known_hosts_path().read_text())
        return {str(k): str(v) for k, v in data.items()}
    except (FileNotFoundError, ValueError, AttributeError):
        return {}


def _save_known(known: dict[str, str]) -> None:
    path = _known_hosts_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".ssh_known_hosts.")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(known, fh, indent=2, sort_keys=True)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def check_host_key(host: str, port: int, fingerprint: str) -> str:
    """Pin on first use. Returns ``"new"`` or ``"match"``; raises on mismatch."""
    known = _load_known()
    ident = f"{host.lower()}:{port}"
    pinned = known.get(ident)
    if pinned is None:
        known[ident] = fingerprint
        _save_known(known)
        return "new"
    if pinned != fingerprint:
        raise GatewayError(
            f"HOST KEY CHANGED for {ident}. Expected {pinned}, got {fingerprint}. "
            "Possible man-in-the-middle; connection aborted. If the server was "
            "legitimately re-keyed, remove its entry from ssh_known_hosts.json."
        )
    return "match"


def _no_trusted_keys(
    host: str, addr: str, port: int | None
) -> tuple[list[Any], list[Any], list[Any]]:
    return [], [], []


class _PinningClient(asyncssh.SSHClient):
    """Validates the host key during the handshake, i.e. before authentication."""

    def __init__(self, host: str, port: int, events: list[dict[str, Any]]) -> None:
        self._host, self._port, self._events = host, port, events

    def validate_host_public_key(
        self, host: str, addr: str, port: int, key: asyncssh.SSHKey
    ) -> bool:
        fp = key.get_fingerprint("sha256")
        try:
            state = check_host_key(self._host, self._port, fp)
        except GatewayError as exc:
            self._events.append({"t": "error", "m": str(exc)})
            return False
        self._events.append({"t": "hostkey", "fp": fp, "new": state == "new"})
        return True


# ------------------------------------------------------------------- bridge


class WsLike(Protocol):
    async def receive(self) -> dict[str, Any]: ...
    async def send_bytes(self, data: bytes) -> None: ...
    async def send_text(self, data: str) -> None: ...


def scrub(msg: str, *secrets_: str | None) -> str:
    out = msg
    for s in secrets_:
        if s:
            out = out.replace(s, "***")
    return out[:300]


async def _send_event(ws: WsLike, ev: dict[str, Any]) -> None:
    # The browser tab may already be gone (closed mid-session); that is normal.
    with contextlib.suppress(RuntimeError, ConnectionError):
        await ws.send_text(json.dumps(ev))


async def run_session(ws: WsLike, ticket: Ticket) -> None:
    """Drive one terminal session. ``ws`` must already be accepted."""
    settings = get_settings()
    if _active[ticket.user_id] >= settings.ssh_max_sessions_per_user:
        await _send_event(ws, {"t": "error", "m": "Too many open terminals for your account"})
        return

    # 1. first frame: credentials + initial size
    try:
        msg = await asyncio.wait_for(ws.receive(), INIT_FRAME_TIMEOUT_SECONDS)
        init = json.loads(msg.get("text") or "")
        if not isinstance(init, dict):
            raise ValueError("init frame must be an object")
        password = init.get("password") or None
        pkey_pem = init.get("private_key") or None
        passphrase = init.get("passphrase") or None
        cols = max(10, min(int(init.get("cols", 80)), 500))
        rows = max(5, min(int(init.get("rows", 24)), 300))
        if not isinstance(password, str | None) or not isinstance(pkey_pem, str | None):
            raise ValueError("bad credential types")
        if not password and not pkey_pem:
            raise ValueError("no credential")
    except (TimeoutError, ValueError, TypeError, AttributeError, json.JSONDecodeError):
        await _send_event(ws, {"t": "error", "m": "Invalid or missing credentials frame"})
        return

    # 2. re-validate target (policy may have changed since the ticket was minted)
    try:
        ip = await resolve_allowed(ticket.host, ticket.port)
    except GatewayError as exc:
        await _send_event(ws, {"t": "error", "m": str(exc)})
        return
    if ip != ticket.ip:
        # DNS answer changed between ticket and connect; still allowlisted, use it.
        logger.info("ssh target %s re-resolved %s -> %s", ticket.host, ticket.ip, ip)

    client_keys: list[asyncssh.SSHKey] = []
    if pkey_pem:
        try:
            client_keys = [asyncssh.import_private_key(pkey_pem, passphrase)]
        except (asyncssh.KeyImportError, asyncssh.KeyEncryptionError, ValueError):
            await _send_event(
                ws, {"t": "error", "m": "Private key is invalid or needs a passphrase"}
            )
            return
    del pkey_pem

    events: list[dict[str, Any]] = []
    started = time.monotonic()
    _active[ticket.user_id] += 1
    conn: asyncssh.SSHClientConnection | None = None
    try:
        await _send_event(ws, {"t": "status", "m": f"Connecting to {ticket.host}:{ticket.port}…"})
        try:
            conn = await asyncio.wait_for(
                asyncssh.connect(
                    ip,
                    ticket.port,
                    username=ticket.username,
                    password=password,
                    client_keys=client_keys or None,
                    passphrase=passphrase,
                    client_factory=lambda: _PinningClient(ticket.host, ticket.port, events),
                    # NOT None (that disables validation). An empty trusted set makes
                    # asyncssh call _PinningClient.validate_host_public_key, which runs
                    # during the handshake, before any credential is sent.
                    known_hosts=_no_trusted_keys,
                    agent_path=None,
                    config=None,
                    login_timeout=settings.ssh_connect_timeout_seconds,
                    keepalive_interval=30,
                ),
                settings.ssh_connect_timeout_seconds + 5,
            )
        except asyncssh.PermissionDenied:
            await _flush(ws, events)
            await _send_event(ws, {"t": "error", "m": "Authentication failed"})
            return
        except (OSError, asyncssh.Error, TimeoutError) as exc:
            await _flush(ws, events)
            if not any(e["t"] == "error" for e in events):
                await _send_event(
                    ws,
                    {"t": "error", "m": scrub(f"Connection failed: {exc}", password, passphrase)},
                )
            return
        finally:
            password = None
            passphrase = None
            client_keys = []

        await _flush(ws, events)
        proc = cast(
            "asyncssh.SSHClientProcess[bytes]",
            await conn.create_process(
                term_type="xterm-256color", term_size=(cols, rows), encoding=None
            ),
        )
        await _send_event(ws, {"t": "ready"})
        code = await _pump(ws, proc, settings.ssh_idle_timeout_seconds)
        await _send_event(ws, {"t": "exit", "code": code})
    finally:
        _active[ticket.user_id] -= 1
        if conn is not None:
            conn.close()
            with contextlib.suppress(Exception):
                await conn.wait_closed()
        logger.info(
            "ssh session user=%s target=%s:%s as=%s duration=%.1fs",
            ticket.email,
            ticket.host,
            ticket.port,
            ticket.username,
            time.monotonic() - started,
        )


async def _flush(ws: WsLike, events: list[dict[str, Any]]) -> None:
    while events:
        await _send_event(ws, events.pop(0))


async def _pump(
    ws: WsLike, proc: asyncssh.SSHClientProcess[bytes], idle_timeout: int
) -> int | None:
    """Bridge until either side ends. Returns the remote exit status if known."""
    last = time.monotonic()
    status: int | None = None

    async def ssh_to_ws() -> None:
        while True:
            try:
                data = await proc.stdout.read(65536)
            except (asyncssh.Error, OSError):
                data = b""  # remote closed the connection: same as EOF
            if not data:
                # EOF: the exit-status message can trail it by a moment.
                nonlocal status
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(proc.wait(check=False), 2)
                status = proc.exit_status  # read BEFORE close() clears it
                return
            await ws.send_bytes(data)

    async def ws_to_ssh() -> None:
        nonlocal last
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                return
            last = time.monotonic()
            if (data := msg.get("bytes")) is not None:
                if len(data) > MAX_INPUT_FRAME_BYTES:
                    return
                proc.stdin.write(data)
            elif (text := msg.get("text")) is not None:
                try:
                    ctl = json.loads(text)
                    if ctl.get("t") == "resize":
                        proc.change_terminal_size(
                            max(10, min(int(ctl["cols"]), 500)),
                            max(5, min(int(ctl["rows"]), 300)),
                        )
                except (ValueError, KeyError, TypeError):
                    continue

    async def idle_watch() -> None:
        while True:
            await asyncio.sleep(15)
            if time.monotonic() - last > idle_timeout:
                await _send_event(ws, {"t": "error", "m": "Closed: idle timeout"})
                return

    tasks = [asyncio.create_task(c()) for c in (ssh_to_ws, ws_to_ssh, idle_watch)]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        with contextlib.suppress(Exception):
            proc.close()
    return status
