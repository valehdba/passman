"""add TOTP columns to users

Revision ID: 0002_totp
Revises: 0001_initial
Create Date: 2026-05-10

Adds three columns to support optional Google Authenticator-style 2FA:
  - totp_secret           BYTEA NULL — RFC 4226/6238 shared secret
  - totp_enabled          BOOL NOT NULL DEFAULT false — flipped on confirm
  - totp_recovery_hashes  TEXT NULL — JSON list of Argon2id-hashed codes

NULL on existing rows = "no 2FA configured", which keeps the existing
login flow unchanged for users who haven't opted in.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_totp"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("totp_secret", sa.LargeBinary(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "totp_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "users",
        sa.Column("totp_recovery_hashes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "totp_recovery_hashes")
    op.drop_column("users", "totp_enabled")
    op.drop_column("users", "totp_secret")
