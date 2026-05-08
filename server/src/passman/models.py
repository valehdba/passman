"""SQLAlchemy ORM models.

Storage philosophy: the server stores **only** ciphertext and KDF parameters.
It never sees plaintext passwords, the master key, or the symmetric vault key.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, TimestampMixin

if TYPE_CHECKING:
    pass


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)

    # Server-side hash of the client-derived auth_key.
    # Format: argon2-cffi PHC string ($argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>).
    auth_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # Client-side KDF parameters. Stored unencrypted — they are NOT secret.
    # Salt is 16 random bytes, base64-encoded.
    kdf_salt: Mapped[str] = mapped_column(String(64), nullable=False)
    kdf_time_cost: Mapped[int] = mapped_column(nullable=False)
    kdf_memory_cost: Mapped[int] = mapped_column(nullable=False)
    kdf_parallelism: Mapped[int] = mapped_column(nullable=False)

    # The user's symmetric vault key, encrypted with their master key.
    # Format: "v1:<base64 IV>:<base64 ciphertext+tag>"
    encrypted_symmetric_key: Mapped[str] = mapped_column(Text, nullable=False)

    # Relationships
    vault_items: Mapped[list[VaultItem]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )
    sessions: Mapped[list[Session]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class VaultItem(Base, TimestampMixin):
    """A single encrypted vault entry (login, secure note, card, etc.).

    The `encrypted_data` blob holds a JSON document encrypted client-side with the
    user's symmetric key. Schema of the plaintext (illustrative — server never parses it):

        { "name": "...", "username": "...", "password": "...",
          "url": "...", "notes": "...", "totp": "otpauth://..." }

    `item_type` is the only metadata stored unencrypted: it's coarse-grained
    (login/note/card) and useful for client-side filtering. Knowing a user has
    "logins" and "notes" is not a meaningful information leak.
    """

    __tablename__ = "vault_items"
    __table_args__ = (Index("ix_vault_items_user_type", "user_id", "item_type"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    item_type: Mapped[str] = mapped_column(String(32), nullable=False, default="login")
    # "v1:<base64 IV>:<base64 ciphertext+tag>"
    encrypted_data: Mapped[str] = mapped_column(Text, nullable=False)

    user: Mapped[User] = relationship(back_populates="vault_items")


class Session(Base, TimestampMixin):
    """Refresh-token-backed session record. Allows server-side revocation."""

    __tablename__ = "sessions"
    __table_args__ = (UniqueConstraint("refresh_token_hash", name="uq_session_refresh"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # SHA-256 of the refresh token; never store the raw token.
    refresh_token_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions")
