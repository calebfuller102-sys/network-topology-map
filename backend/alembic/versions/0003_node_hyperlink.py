"""Add optional node hyperlinks.

Revision ID: 0003_node_hyperlink
Revises: 0002_map_events
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0003_node_hyperlink"
down_revision = "0002_map_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("nodes", sa.Column("hyperlink", sa.String(length=2048), nullable=True))


def downgrade() -> None:
    op.drop_column("nodes", "hyperlink")
