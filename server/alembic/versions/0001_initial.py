"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-08

"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("auth_hash", sa.String(255), nullable=False),
        sa.Column("kdf_salt", sa.String(64), nullable=False),
        sa.Column("kdf_time_cost", sa.Integer(), nullable=False),
        sa.Column("kdf_memory_cost", sa.Integer(), nullable=False),
        sa.Column("kdf_parallelism", sa.Integer(), nullable=False),
        sa.Column("encrypted_symmetric_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "vault_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("item_type", sa.String(32), nullable=False, server_default="login"),
        sa.Column("encrypted_data", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_vault_items_user_type", "vault_items", ["user_id", "item_type"]
    )

    op.create_table(
        "sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("refresh_token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_agent", sa.String(255), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("refresh_token_hash", name="uq_session_refresh"),
    )
    op.create_index(
        "ix_sessions_refresh_token_hash", "sessions", ["refresh_token_hash"]
    )


def downgrade() -> None:
    op.drop_index("ix_sessions_refresh_token_hash", table_name="sessions")
    op.drop_table("sessions")
    op.drop_index("ix_vault_items_user_type", table_name="vault_items")
    op.drop_table("vault_items")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
