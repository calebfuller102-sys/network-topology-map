"""Add named topology groups and persisted perimeter link handles.

Revision ID: 0004_groups_and_link_handles
Revises: 0003_node_hyperlink
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0004_groups_and_link_handles"
down_revision = "0003_node_hyperlink"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "groups",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("map_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("width", sa.Float(), nullable=False),
        sa.Column("height", sa.Float(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.CheckConstraint("width >= 260", name="ck_groups_width"),
        sa.CheckConstraint("height >= 160", name="ck_groups_height"),
        sa.ForeignKeyConstraint(["map_id"], ["maps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_groups_map", "groups", ["map_id"])
    with op.batch_alter_table("nodes") as batch:
        batch.add_column(sa.Column("group_id", sa.String(length=36), nullable=True))
        batch.create_foreign_key("fk_nodes_group_id", "groups", ["group_id"], ["id"], ondelete="SET NULL")
    with op.batch_alter_table("links") as batch:
        batch.add_column(sa.Column("source_handle", sa.String(length=20), nullable=True))
        batch.add_column(sa.Column("target_handle", sa.String(length=20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("links") as batch:
        batch.drop_column("target_handle")
        batch.drop_column("source_handle")
    with op.batch_alter_table("nodes") as batch:
        batch.drop_constraint("fk_nodes_group_id", type_="foreignkey")
        batch.drop_column("group_id")
    op.drop_index("ix_groups_map", table_name="groups")
    op.drop_table("groups")
