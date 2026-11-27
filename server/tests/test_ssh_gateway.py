"""Tests for the in-browser SSH terminal gateway.

An in-process asyncssh server stands in for the target host, so the real
connect → pty → bridge path is exercised (no mocks of asyncssh itself).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import asyncssh
import pytest

from passman import ssh_gateway as gw
from passman.config import get_settings

from .conftest import make_register_payload

USER, PASSWORD = "alice", "correct horse"
UID = uuid.uuid4()


# --------------------------------------------------------------- fixtures


class _Server(asyncssh.SSHServer):
    def __init__(self, client_pub: asyncssh.SSHKey | None) -> None:
        self._client_pub = client_pub

    def begin_auth(self, username: str) -> bool:
        return True

    def password_auth_supported(self) -> bool:
        return True

    def validate_password(self, username: str, password: str) -> bool:
        return username == USER and password == PASSWORD

    def public_key_auth_supported(self) -> bool:
        return self._client_pub is not None

    def validate_public_key(self, username: str, key: asyncssh.SSHKey) -> bool:
        return (
            self._client_pub is not None
            and username == USER
            and key.public_data == self._client_pub.public_data
        )


async def _shell(process: asyncssh.SSHServerProcess[bytes]) -> None:
    process.stdout.write(b"hello\r\n")
    while True:
        data = await process.stdin.read(1024)
        if not data:
            break
        if data.strip() == b"exit":
            process.exit(3)
            return
        process.stdout.write(b"echo:" + data)
    process.exit(0)


@pytest.fixture
def client_key() -> asyncssh.SSHKey:
    return asyncssh.generate_private_key("ssh-ed25519")


@pytest.fixture
async def ssh_server(client_key) -> AsyncIterator[int]:  # type: ignore[no-untyped-def]
    host_key = asyncssh.generate_private_key("ssh-ed25519")
    pub = asyncssh.import_public_key(client_key.export_public_key())
    server = await asyncssh.listen(
        "127.0.0.1",
        0,
        server_factory=lambda: _Server(pub),
        server_host_keys=[host_key],
        process_factory=_shell,
        encoding=None,
    )
    try:
        yield server.sockets[0].getsockname()[1]
    finally:
        server.close()
        await server.wait_closed()


@pytest.fixture(autouse=True)
def _settings(monkeypatch, tmp_path):  # type: ignore[no-untyped-def]
    s = get_settings()
    monkeypatch.setattr(s, "ssh_allowed_hosts", ["127.0.0.0/8", "::1/128"])
    monkeypatch.setattr(s, "data_dir", str(tmp_path))
    monkeypatch.setattr(s, "ssh_connect_timeout_seconds", 5)
    gw._active.clear()
    gw.tickets._tickets.clear()
    gw.tickets._minted.clear()


class FakeWs:
    """Queue-backed stand-in for the accepted WebSocket."""

    def __init__(self) -> None:
        self.incoming: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.events: list[dict[str, Any]] = []
        self.output = b""

    async def receive(self) -> dict[str, Any]:
        return await self.incoming.get()

    async def send_bytes(self, data: bytes) -> None:
        self.output += data

    async def send_text(self, data: str) -> None:
        self.events.append(json.loads(data))

    def client_text(self, obj: dict[str, Any]) -> None:
        self.incoming.put_nowait({"type": "websocket.receive", "text": json.dumps(obj)})

    def client_bytes(self, data: bytes) -> None:
        self.incoming.put_nowait({"type": "websocket.receive", "bytes": data})

    def kinds(self) -> list[str]:
        return [e["t"] for e in self.events]


def _ticket(port: int, host: str = "127.0.0.1", user_id: uuid.UUID = UID) -> gw.Ticket:
    return gw.new_ticket(user_id, "a@example.com", host, port, USER, host)


async def _until(cond, timeout: float = 5.0) -> None:  # type: ignore[no-untyped-def]
    async def poll() -> None:
        while not cond():
            await asyncio.sleep(0.02)

    await asyncio.wait_for(poll(), timeout)


# -------------------------------------------------------------- allowlist


async def test_empty_allowlist_disables_feature(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(get_settings(), "ssh_allowed_hosts", [])
    assert not gw.gateway_enabled()
    with pytest.raises(gw.GatewayDisabledError):
        await gw.resolve_allowed("127.0.0.1", 22)


async def test_ip_and_cidr_matching(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(get_settings(), "ssh_allowed_hosts", ["10.1.0.0/16", "192.168.5.7"])
    assert await gw.resolve_allowed("10.1.2.3", 22) == "10.1.2.3"
    assert await gw.resolve_allowed("192.168.5.7", 22) == "192.168.5.7"
    for bad in ("10.2.0.1", "192.168.5.8", "169.254.169.254", "127.0.0.1"):
        with pytest.raises(gw.HostNotAllowedError):
            await gw.resolve_allowed(bad, 22)


async def test_hostname_rules(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    async def fake_resolve(host: str, port: int) -> list[str]:
        return {"db.corp.local": ["10.9.9.9"], "evil.example": ["10.9.9.9"]}.get(host.lower(), [])

    monkeypatch.setattr(gw, "_resolve", fake_resolve)
    monkeypatch.setattr(get_settings(), "ssh_allowed_hosts", ["db.corp.local", "*.lab.test"])
    assert await gw.resolve_allowed("db.corp.local", 22) == "10.9.9.9"
    assert await gw.resolve_allowed("DB.Corp.Local", 22) == "10.9.9.9"
    with pytest.raises(gw.HostNotAllowedError):
        await gw.resolve_allowed("evil.example", 22)  # same IP but not allowlisted by name/CIDR

    async def lab(host: str, port: int) -> list[str]:
        return ["172.16.0.5"]

    monkeypatch.setattr(gw, "_resolve", lab)
    assert await gw.resolve_allowed("x.lab.test", 22) == "172.16.0.5"
    with pytest.raises(gw.HostNotAllowedError):
        await gw.resolve_allowed("lab.test", 22)  # wildcard does not match the apex


async def test_hostname_allowed_by_cidr_requires_all_ips(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(get_settings(), "ssh_allowed_hosts", ["10.0.0.0/8"])

    async def mixed(host: str, port: int) -> list[str]:
        return ["10.0.0.5", "8.8.8.8"]  # rebinding-style: one internal, one external

    monkeypatch.setattr(gw, "_resolve", mixed)
    with pytest.raises(gw.HostNotAllowedError):
        await gw.resolve_allowed("sneaky.example", 22)

    async def inside(host: str, port: int) -> list[str]:
        return ["10.0.0.5", "10.0.0.6"]

    monkeypatch.setattr(gw, "_resolve", inside)
    assert await gw.resolve_allowed("ok.example", 22) == "10.0.0.5"


# ---------------------------------------------------------------- tickets


def test_ticket_is_single_use_and_expires() -> None:
    store = gw.TicketStore()
    t = gw.Ticket(UID, "a@x", "h", 22, "u", "1.2.3.4", expires_at=100.0)
    tok = store.mint(t, now=50.0)
    assert store.consume(tok, now=60.0) == t
    assert store.consume(tok, now=61.0) is None  # single use
    tok2 = store.mint(t, now=50.0)
    assert store.consume(tok2, now=100.0) is None  # expired
    assert store.consume("nope", now=1.0) is None


def test_ticket_rate_limit(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(get_settings(), "ssh_tickets_per_minute", 2)
    store = gw.TicketStore()
    t = gw.Ticket(UID, "a@x", "h", 22, "u", "1.2.3.4", expires_at=1e9)
    store.mint(t, now=0.0)
    store.mint(t, now=1.0)
    with pytest.raises(gw.GatewayError, match="Too many"):
        store.mint(t, now=2.0)
    store.mint(t, now=61.0)  # window slid


# -------------------------------------------------------------- endpoints


async def _headers(client, email: str) -> dict[str, str]:  # type: ignore[no-untyped-def]
    reg = make_register_payload(email)
    await client.post("/api/accounts/register", json=reg)
    r = await client.post("/api/sessions", json={"email": email, "auth_key": reg["auth_key"]})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_endpoints_require_auth(client) -> None:  # type: ignore[no-untyped-def]
    assert (await client.get("/api/ssh/config")).status_code == 401
    r = await client.post("/api/ssh/tickets", json={"host": "127.0.0.1", "username": "a"})
    assert r.status_code == 401


async def test_config_and_ticket_policy(client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    h = await _headers(client, "ssh1@example.com")
    assert (await client.get("/api/ssh/config", headers=h)).json() == {"enabled": True}

    ok = await client.post(
        "/api/ssh/tickets", json={"host": "127.0.0.1", "port": 2222, "username": "a"}, headers=h
    )
    assert ok.status_code == 201
    assert ok.json()["ticket"] and ok.json()["expires_in"] == gw.TICKET_TTL_SECONDS

    denied = await client.post(
        "/api/ssh/tickets", json={"host": "8.8.8.8", "username": "a"}, headers=h
    )
    assert denied.status_code == 403
    assert "allowlist" in denied.json()["detail"]

    monkeypatch.setattr(get_settings(), "ssh_allowed_hosts", [])
    assert (await client.get("/api/ssh/config", headers=h)).json() == {"enabled": False}
    off = await client.post(
        "/api/ssh/tickets", json={"host": "127.0.0.1", "username": "a"}, headers=h
    )
    assert off.status_code == 403


async def test_ticket_validation_and_rate_limit(client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    h = await _headers(client, "ssh2@example.com")
    for bad in (
        {"host": "", "username": "a"},
        {"host": "a b", "username": "a"},
        {"host": "127.0.0.1", "port": 0, "username": "a"},
        {"host": "127.0.0.1", "username": ""},
    ):
        assert (await client.post("/api/ssh/tickets", json=bad, headers=h)).status_code == 422
    monkeypatch.setattr(get_settings(), "ssh_tickets_per_minute", 1)
    body = {"host": "127.0.0.1", "username": "a"}
    assert (await client.post("/api/ssh/tickets", json=body, headers=h)).status_code == 201
    assert (await client.post("/api/ssh/tickets", json=body, headers=h)).status_code == 429


# ------------------------------------------------------------ the bridge


async def test_password_session_end_to_end(ssh_server) -> None:  # type: ignore[no-untyped-def]
    ws = FakeWs()
    ws.client_text({"password": PASSWORD, "cols": 100, "rows": 30})
    task = asyncio.create_task(gw.run_session(ws, _ticket(ssh_server)))

    await _until(lambda: b"hello" in ws.output)
    ws.client_bytes(b"ls\r")
    await _until(lambda: b"echo:ls" in ws.output)
    ws.client_text({"t": "resize", "cols": 120, "rows": 40})
    ws.client_text({"t": "resize", "cols": "bad"})  # ignored, must not kill the session
    ws.client_bytes(b"exit\r")
    await asyncio.wait_for(task, 5)

    kinds = ws.kinds()
    assert "ready" in kinds and kinds[-1] == "exit"
    # The in-process test server drops the whole connection on exit, so the status
    # may not arrive; the real-sshd Docker test asserts the exact code.
    assert ws.events[-1]["code"] in (3, None)
    hk = next(e for e in ws.events if e["t"] == "hostkey")
    assert hk["new"] is True and hk["fp"].startswith("SHA256:")
    assert gw._active[UID] == 0


async def test_private_key_login(ssh_server, client_key) -> None:  # type: ignore[no-untyped-def]
    ws = FakeWs()
    pem = client_key.export_private_key().decode()
    ws.client_text({"private_key": pem, "cols": 80, "rows": 24})
    task = asyncio.create_task(gw.run_session(ws, _ticket(ssh_server)))
    await _until(lambda: b"hello" in ws.output)
    ws.client_bytes(b"exit\r")
    await asyncio.wait_for(task, 5)
    assert "ready" in ws.kinds()


async def test_wrong_password_reports_auth_failure_without_leaking(ssh_server) -> None:  # type: ignore[no-untyped-def]
    ws = FakeWs()
    ws.client_text({"password": "SUPERSECRET-wrong"})
    await asyncio.wait_for(gw.run_session(ws, _ticket(ssh_server)), 10)
    assert {"t": "error", "m": "Authentication failed"} in ws.events
    assert "ready" not in ws.kinds()
    assert "SUPERSECRET-wrong" not in json.dumps(ws.events)
    assert gw._active[UID] == 0


async def test_unreachable_target_error_is_scrubbed() -> None:
    ws = FakeWs()
    ws.client_text({"password": "TOPSECRET"})
    await asyncio.wait_for(gw.run_session(ws, _ticket(1)), 15)  # nothing listens on :1
    err = [e for e in ws.events if e["t"] == "error"]
    assert err and "TOPSECRET" not in json.dumps(ws.events)


async def test_host_key_pinned_then_match_then_mismatch(ssh_server, tmp_path) -> None:  # type: ignore[no-untyped-def]
    async def one() -> FakeWs:
        ws = FakeWs()
        ws.client_text({"password": PASSWORD})
        task = asyncio.create_task(gw.run_session(ws, _ticket(ssh_server)))
        await _until(lambda: "ready" in ws.kinds())
        ws.client_bytes(b"exit\r")
        await asyncio.wait_for(task, 5)
        return ws

    first = await one()
    assert next(e for e in first.events if e["t"] == "hostkey")["new"] is True
    second = await one()
    assert next(e for e in second.events if e["t"] == "hostkey")["new"] is False

    # Tamper with the pin → connection must abort BEFORE authentication.
    path = tmp_path / "ssh_known_hosts.json"
    known = json.loads(path.read_text())
    ident = next(iter(known))
    known[ident] = "SHA256:AAAA-not-the-real-key"
    path.write_text(json.dumps(known))
    ws = FakeWs()
    ws.client_text({"password": PASSWORD})
    await asyncio.wait_for(gw.run_session(ws, _ticket(ssh_server)), 10)
    assert any(e["t"] == "error" and "HOST KEY CHANGED" in e["m"] for e in ws.events)
    assert "ready" not in ws.kinds()


async def test_bad_init_frames_rejected(ssh_server) -> None:  # type: ignore[no-untyped-def]
    for frame in ("not json", json.dumps({}), json.dumps({"password": 5}), json.dumps([])):
        ws = FakeWs()
        ws.incoming.put_nowait({"type": "websocket.receive", "text": frame})
        await asyncio.wait_for(gw.run_session(ws, _ticket(ssh_server)), 5)
        assert ws.events and ws.events[0]["t"] == "error"


async def test_policy_rechecked_at_connect_time(ssh_server, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    ticket = _ticket(ssh_server)
    monkeypatch.setattr(get_settings(), "ssh_allowed_hosts", ["10.0.0.0/8"])  # revoked since
    ws = FakeWs()
    ws.client_text({"password": PASSWORD})
    await asyncio.wait_for(gw.run_session(ws, ticket), 5)
    assert ws.events[0]["t"] == "error" and "allowlist" in ws.events[0]["m"]


async def test_per_user_session_cap(ssh_server, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(get_settings(), "ssh_max_sessions_per_user", 1)
    ws1 = FakeWs()
    ws1.client_text({"password": PASSWORD})
    t1 = asyncio.create_task(gw.run_session(ws1, _ticket(ssh_server)))
    await _until(lambda: "ready" in ws1.kinds())

    ws2 = FakeWs()
    await asyncio.wait_for(gw.run_session(ws2, _ticket(ssh_server)), 5)
    assert ws2.events[0]["t"] == "error" and "Too many" in ws2.events[0]["m"]

    ws1.client_bytes(b"exit\r")
    await asyncio.wait_for(t1, 5)
    assert gw._active[UID] == 0


async def test_client_disconnect_tears_down(ssh_server) -> None:  # type: ignore[no-untyped-def]
    ws = FakeWs()
    ws.client_text({"password": PASSWORD})
    task = asyncio.create_task(gw.run_session(ws, _ticket(ssh_server)))
    await _until(lambda: "ready" in ws.kinds())
    ws.incoming.put_nowait({"type": "websocket.disconnect"})
    await asyncio.wait_for(task, 5)
    assert gw._active[UID] == 0
