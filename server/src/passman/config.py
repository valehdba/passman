"""Application settings loaded from environment variables.

All secrets MUST come from the environment — never commit values here.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Reads from `.env` for local dev; env vars override."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Application ---
    env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    # --- Database ---
    # Example: postgresql+asyncpg://user:pass@localhost:5432/passman
    database_url: str = Field(
        default="postgresql+asyncpg://passman:passman@localhost:5432/passman",
        description="Async SQLAlchemy database URL",
    )

    # --- Auth / Crypto ---
    # JWT signing secret — MUST be set in production. Use `openssl rand -hex 64`.
    jwt_secret: SecretStr = Field(default=SecretStr("change-me-in-production-please"))
    jwt_algorithm: str = "HS256"
    access_token_ttl_seconds: int = 60 * 15  # 15 minutes
    refresh_token_ttl_seconds: int = 60 * 60 * 24 * 30  # 30 days

    # Server-side Argon2 params for hashing the (already client-stretched) auth_key.
    # These can be modest because the input has high entropy — the expensive KDF runs client-side.
    server_argon2_time_cost: int = 2
    server_argon2_memory_cost: int = 19_456  # ~19 MiB (RFC 9106 minimum)
    server_argon2_parallelism: int = 1

    # Default client-side Argon2id params (returned to new accounts; per-user upgradable).
    client_argon2_time_cost: int = 3
    client_argon2_memory_cost: int = 65_536  # 64 MiB
    client_argon2_parallelism: int = 4

    # --- CORS ---
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "chrome-extension://*"]
    )

    # --- Rate limiting ---
    login_attempts_per_15min: int = 10

    @field_validator("jwt_secret")
    @classmethod
    def _reject_default_in_prod(cls, v: SecretStr, info) -> SecretStr:  # type: ignore[no-untyped-def]
        # Validation runs on each instantiation; in prod we require a real secret.
        env = info.data.get("env", "development")
        if env == "production" and v.get_secret_value().startswith("change-me"):
            raise ValueError("JWT_SECRET must be set to a strong value in production")
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings accessor — Settings is immutable after first read."""
    return Settings()
