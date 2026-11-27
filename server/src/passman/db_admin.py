"""Runtime database switching: encrypted persistence, connection testing, migration.

Security notes
--------------
* The saved connection (including password) is encrypted at rest with Fernet.
  The key is derived (HKDF-SHA256) from ``JWT_SECRET``. Rotating ``JWT_SECRET``
  makes the saved file undecryptable; the server then logs a warning and falls
  back to the ``DATABASE_URL`` from the environment.
* Passwords never appear in logs or API responses. Error text from drivers is
  scrubbed before it is returned.
* Switching only *connects to and migrates* the target database. The previous
  database is never modified, copied or deleted.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import inspect, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from .config import get_settings
from .db import current_engine, make_engine, switch_engine

logger = logging.getLogger("passman.db_admin")

SslMode = Literal["disable", "prefer", "require"]
SETTINGS_FILENAME = "db_connection.enc"
MIN_PG_VERSION_NUM = 140000  # PostgreSQL 14
CONNECT_TIMEOUT_SECONDS = 5

_switch_lock = asyncio.Lock()


@dataclass(frozen=True)
class DbConnection:
    host: str
    port: int
    database: str
    username: str
    password: str
    sslmode: SslMode = "prefer"

    def to_url(self) -> URL:
        return URL.create(
            "postgresql+asyncpg",
            username=self.username,
            password=self.password,
            host=self.host,
            port=self.port,
            database=self.database,
            query={"ssl": self.sslmode},
        )

    def public(self) -> dict[str, object]:
        """Everything except the password."""
        return {
            "host": self.host,
            "port": self.port,
            "database": self.database,
            "username": self.username,
            "sslmode": self.sslmode,
        }


def describe_url(url: str) -> dict[str, object]:
    """Password-free description of an arbitrary SQLAlchemy URL (for the UI)."""
    u = make_url(url)
    return {
        "host": u.host or "",
        "port": u.port,
        "database": u.database or "",
        "username": u.username or "",
        "sslmode": str(u.query.get("ssl", "")) or None,
    }


def scrub(message: str, password: str) -> str:
    """Remove the password (and URL-encoded forms) from driver error text."""
    out = message
    if password:
        out = out.replace(password, "***")
    return out[:300]


# ---------------------------------------------------------------- persistence


def _fernet() -> Fernet:
    secret = get_settings().jwt_secret.get_secret_value().encode("utf-8")
    key = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=b"passman-db-settings-v1"
    ).derive(secret)
    return Fernet(base64.urlsafe_b64encode(key))


def _settings_path() -> Path:
    return Path(get_settings().data_dir) / SETTINGS_FILENAME


def save_connection(conn: DbConnection) -> None:
    """Atomically write the encrypted connection file with 0600 permissions."""
    path = _settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({**conn.public(), "password": conn.password}).encode("utf-8")
    token = _fernet().encrypt(payload)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".db_connection.")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(token)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def load_connection() -> DbConnection | None:
    """Return the saved connection, or None if absent/unreadable."""
    path = _settings_path()
    try:
        token = path.read_bytes()
    except FileNotFoundError:
        return None
    try:
        data = json.loads(_fernet().decrypt(token))
        return DbConnection(
            host=data["host"],
            port=int(data["port"]),
            database=data["database"],
            username=data["username"],
            password=data["password"],
            sslmode=data.get("sslmode", "prefer"),
        )
    except (InvalidToken, KeyError, ValueError, TypeError):
        logger.warning(
            "saved database connection at %s could not be decrypted/parsed "
            "(was JWT_SECRET rotated?); falling back to DATABASE_URL",
            path,
        )
        return None


def clear_connection() -> None:
    _settings_path().unlink(missing_ok=True)


def has_saved_connection() -> bool:
    return _settings_path().exists()


# ------------------------------------------------------------------- checking


SchemaState = Literal["empty", "current", "outdated", "unmanaged", "unknown"]


@dataclass
class CheckResult:
    ok: bool
    server_version: str | None = None
    schema_state: SchemaState = "unknown"
    error: str | None = None


def _alembic_config(url: str | None = None) -> Config:
    cfg = Config(get_settings().alembic_ini)
    if url is not None:
        cfg.attributes["database_url"] = url
    return cfg


def _head_revision() -> str | None:
    return ScriptDirectory.from_config(_alembic_config()).get_current_head()


async def check_connection(conn: DbConnection) -> CheckResult:
    """Connect, verify PostgreSQL >= 14, and classify the schema. No writes."""
    engine = create_async_engine(
        conn.to_url(),
        pool_pre_ping=False,
        connect_args={"timeout": CONNECT_TIMEOUT_SECONDS},
    )
    try:
        async with engine.connect() as c:
            await c.execute(text("SELECT 1"))
            ver_num = int((await c.execute(text("SHOW server_version_num"))).scalar_one())
            ver = str((await c.execute(text("SHOW server_version"))).scalar_one())
            if ver_num < MIN_PG_VERSION_NUM:
                return CheckResult(False, ver, error=f"PostgreSQL 14+ required (server is {ver})")
            tables = await c.run_sync(lambda sc: set(inspect(sc).get_table_names()))
            state: SchemaState
            if not tables:
                state = "empty"
            elif "alembic_version" not in tables:
                return CheckResult(
                    False,
                    ver,
                    "unmanaged",
                    "Target database already has tables that Passman did not create. "
                    "Use an empty database (or one previously used by Passman).",
                )
            else:
                current = (
                    await c.execute(text("SELECT version_num FROM alembic_version"))
                ).scalar()
                state = "current" if current == _head_revision() else "outdated"
            return CheckResult(True, ver, state)
    except Exception as exc:
        return CheckResult(False, error=scrub(f"{type(exc).__name__}: {exc}", conn.password))
    finally:
        await engine.dispose()


async def run_migrations(conn: DbConnection) -> None:
    """Apply Alembic migrations to the target database (in a worker thread)."""
    url = conn.to_url().render_as_string(hide_password=False)
    await asyncio.to_thread(command.upgrade, _alembic_config(url), "head")


# ------------------------------------------------------------------ switching


async def apply_connection(conn: DbConnection, *, persist: bool = True) -> None:
    """Migrate the target, persist it (encrypted), then swap the live engine.

    Order matters: if migration or persistence fails, nothing has changed.
    """
    async with _switch_lock:
        await run_migrations(conn)
        if persist:
            save_connection(conn)
        await switch_engine(make_engine(conn.to_url().render_as_string(hide_password=False)))


async def reset_to_environment() -> None:
    """Forget the saved connection and go back to ``DATABASE_URL``."""
    async with _switch_lock:
        clear_connection()
        await switch_engine(make_engine(get_settings().database_url))


async def apply_saved_connection_on_startup() -> None:
    """If an admin saved a connection earlier, use it instead of ``DATABASE_URL``."""
    conn = load_connection()
    if conn is None:
        return
    engine: AsyncEngine = make_engine(conn.to_url().render_as_string(hide_password=False))
    try:
        async with engine.connect() as c:
            await c.execute(text("SELECT 1"))
    except Exception as exc:
        await engine.dispose()
        logger.error(
            "saved database %s:%s/%s unreachable (%s); using DATABASE_URL instead",
            conn.host,
            conn.port,
            conn.database,
            scrub(type(exc).__name__, conn.password),
        )
        return
    await switch_engine(engine)
    logger.info("using saved database %s:%s/%s", conn.host, conn.port, conn.database)


def active_source() -> Literal["saved", "env"]:
    return "saved" if has_saved_connection() and load_connection() is not None else "env"


def active_description() -> dict[str, object]:
    return describe_url(current_engine().url.render_as_string(hide_password=True))
