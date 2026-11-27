"""Tests for the admin-only "switch database" feature.

The real connect/migrate path needs PostgreSQL and is exercised by hand and in
CI's Postgres job; here we cover access control, validation, the encrypted
persistence, secret scrubbing and the endpoint orchestration with the DB layer
stubbed.
"""

from __future__ import annotations

import pytest

from passman import db_admin
from passman.config import get_settings

from .conftest import make_register_payload

ADMIN = "admin@example.com"
GOOD = {
    "host": "db.internal",
    "port": 5432,
    "database": "passman2",
    "username": "passman",
    "password": "s3cr3t-pw",
    "sslmode": "require",
}


@pytest.fixture(autouse=True)
def _admin_settings(monkeypatch, tmp_path):  # type: ignore[no-untyped-def]
    s = get_settings()
    monkeypatch.setattr(s, "admin_email", ADMIN)
    monkeypatch.setattr(s, "data_dir", str(tmp_path))


async def _headers(client, email: str) -> dict[str, str]:  # type: ignore[no-untyped-def]
    reg = make_register_payload(email)
    await client.post("/api/accounts/register", json=reg)
    resp = await client.post("/api/sessions", json={"email": email, "auth_key": reg["auth_key"]})
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# ------------------------------------------------------------- access control


async def test_requires_auth(client) -> None:  # type: ignore[no-untyped-def]
    assert (await client.get("/api/admin/database")).status_code == 401


async def test_non_admin_forbidden_everywhere(client) -> None:  # type: ignore[no-untyped-def]
    h = await _headers(client, "someone@example.com")
    assert (await client.get("/api/admin/database", headers=h)).status_code == 403
    assert (await client.post("/api/admin/database/test", json=GOOD, headers=h)).status_code == 403
    assert (
        await client.put("/api/admin/database", json={**GOOD, "confirm": True}, headers=h)
    ).status_code == 403
    assert (await client.delete("/api/admin/database", headers=h)).status_code == 403


async def test_disabled_when_admin_email_unset(client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    h = await _headers(client, ADMIN)
    monkeypatch.setattr(get_settings(), "admin_email", "")
    assert (await client.get("/api/admin/database", headers=h)).status_code == 403


async def test_admin_email_match_is_case_insensitive(client) -> None:  # type: ignore[no-untyped-def]
    h = await _headers(client, ADMIN)
    get_settings().admin_email = "ADMIN@Example.com"
    resp = await client.get("/api/admin/database", headers=h)
    assert resp.status_code == 200
    assert resp.json()["source"] == "env"


# ----------------------------------------------------------------- validation


@pytest.mark.parametrize(
    "patch",
    [
        {"port": 0},
        {"port": 70000},
        {"host": ""},
        {"host": "a b"},
        {"database": ""},
        {"sslmode": "x"},
    ],
)
async def test_invalid_input_rejected(client, patch) -> None:  # type: ignore[no-untyped-def]
    h = await _headers(client, ADMIN)
    resp = await client.post("/api/admin/database/test", json={**GOOD, **patch}, headers=h)
    assert resp.status_code == 422


async def test_switch_requires_confirmation(client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    h = await _headers(client, ADMIN)
    called = False

    async def boom(*a, **k):  # type: ignore[no-untyped-def]
        nonlocal called
        called = True

    monkeypatch.setattr(db_admin, "apply_connection", boom)
    resp = await client.put("/api/admin/database", json=GOOD, headers=h)
    assert resp.status_code == 400
    assert not called


# -------------------------------------------------------------- orchestration


async def test_test_endpoint_reports_result_without_password(client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    h = await _headers(client, ADMIN)

    async def fake_check(conn):  # type: ignore[no-untyped-def]
        assert conn.password == "s3cr3t-pw"
        return db_admin.CheckResult(True, "16.4", "empty")

    monkeypatch.setattr(db_admin, "check_connection", fake_check)
    resp = await client.post("/api/admin/database/test", json=GOOD, headers=h)
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"ok": True, "server_version": "16.4", "schema_state": "empty", "error": None}
    assert "s3cr3t-pw" not in resp.text


async def test_switch_rejects_failed_check_and_does_not_apply(client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    h = await _headers(client, ADMIN)
    applied = False

    async def fake_check(conn):  # type: ignore[no-untyped-def]
        return db_admin.CheckResult(False, error="OSError: connection refused")

    async def fake_apply(conn, **k):  # type: ignore[no-untyped-def]
        nonlocal applied
        applied = True

    monkeypatch.setattr(db_admin, "check_connection", fake_check)
    monkeypatch.setattr(db_admin, "apply_connection", fake_apply)
    resp = await client.put("/api/admin/database", json={**GOOD, "confirm": True}, headers=h)
    assert resp.status_code == 400
    assert "connection refused" in resp.json()["detail"]
    assert not applied


async def test_switch_success_and_failure_paths(client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    h = await _headers(client, ADMIN)
    seen = {}

    async def ok_check(conn):  # type: ignore[no-untyped-def]
        return db_admin.CheckResult(True, "16.4", "outdated")

    async def ok_apply(conn, **k):  # type: ignore[no-untyped-def]
        seen["conn"] = conn

    monkeypatch.setattr(db_admin, "check_connection", ok_check)
    monkeypatch.setattr(db_admin, "apply_connection", ok_apply)
    resp = await client.put("/api/admin/database", json={**GOOD, "confirm": True}, headers=h)
    assert resp.status_code == 200
    assert seen["conn"].database == "passman2"
    assert "s3cr3t-pw" not in resp.text

    async def bad_apply(conn, **k):  # type: ignore[no-untyped-def]
        raise RuntimeError("migration failed for password s3cr3t-pw")

    monkeypatch.setattr(db_admin, "apply_connection", bad_apply)
    resp = await client.put("/api/admin/database", json={**GOOD, "confirm": True}, headers=h)
    assert resp.status_code == 500
    assert "s3cr3t-pw" not in resp.text
    assert "nothing was changed" in resp.json()["detail"]


async def test_reset_endpoint(client, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    h = await _headers(client, ADMIN)
    called = False

    async def fake_reset() -> None:
        nonlocal called
        called = True

    monkeypatch.setattr(db_admin, "reset_to_environment", fake_reset)
    assert (await client.delete("/api/admin/database", headers=h)).status_code == 200
    assert called


# ---------------------------------------------------------------- persistence


def _conn() -> db_admin.DbConnection:
    return db_admin.DbConnection(**{**GOOD})  # type: ignore[arg-type]


def test_saved_connection_is_encrypted_and_roundtrips(tmp_path) -> None:  # type: ignore[no-untyped-def]
    db_admin.save_connection(_conn())
    raw = (tmp_path / db_admin.SETTINGS_FILENAME).read_bytes()
    assert b"s3cr3t-pw" not in raw and b"db.internal" not in raw
    assert (tmp_path / db_admin.SETTINGS_FILENAME).stat().st_mode & 0o777 == 0o600
    assert db_admin.load_connection() == _conn()
    assert db_admin.has_saved_connection()
    db_admin.clear_connection()
    assert db_admin.load_connection() is None


def test_secret_rotation_makes_file_unreadable_but_safe(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from pydantic import SecretStr

    db_admin.save_connection(_conn())
    monkeypatch.setattr(get_settings(), "jwt_secret", SecretStr("a-different-secret-" + "x" * 30))
    assert db_admin.load_connection() is None  # falls back, does not raise


def test_corrupt_file_is_ignored(tmp_path) -> None:  # type: ignore[no-untyped-def]
    (tmp_path / db_admin.SETTINGS_FILENAME).write_bytes(b"not-a-fernet-token")
    assert db_admin.load_connection() is None


def test_url_building_escapes_special_characters() -> None:
    c = db_admin.DbConnection("h", 5432, "d", "u@x", "p@ss:/w#rd?", "disable")
    rendered = c.to_url().render_as_string(hide_password=False)
    assert "p@ss" not in rendered.split("@", 1)[0].split(":", 2)[2]  # '@' in pw is escaped
    assert c.to_url().password == "p@ss:/w#rd?"
    assert "***" in c.to_url().render_as_string(hide_password=True)


def test_scrub_removes_password() -> None:
    assert "hunter2" not in db_admin.scrub("auth failed for hunter2 at host", "hunter2")
    assert len(db_admin.scrub("x" * 1000, "")) == 300
