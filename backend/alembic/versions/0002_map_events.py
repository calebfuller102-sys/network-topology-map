"""Add the bounded SSE handoff journal.

Revision ID: 0002_map_events
Revises: 0001_initial
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002_map_events"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "map_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("map_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["map_id"], ["maps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_map_events_map_revision", "map_events", ["map_id", "id"])


def downgrade() -> None:
    op.drop_index("ix_map_events_map_revision", table_name="map_events")
    op.drop_table("map_events")
