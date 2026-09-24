"""Initial topology schema.

Revision ID: 0001_initial
Revises:
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "maps",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("viewport_x", sa.Float(), nullable=False),
        sa.Column("viewport_y", sa.Float(), nullable=False),
        sa.Column("viewport_zoom", sa.Float(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "nodes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("map_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("icon_id", sa.String(length=100), nullable=False),
        sa.Column("ipv4", sa.String(length=15), nullable=True),
        sa.Column("display_port", sa.Integer(), nullable=True),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.CheckConstraint("kind IN ('device','vm','container','kubernetes','service','cloud','other')", name="ck_nodes_kind"),
        sa.CheckConstraint("display_port IS NULL OR display_port BETWEEN 1 AND 65535", name="ck_nodes_port"),
        sa.ForeignKeyConstraint(["map_id"], ["maps.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_nodes_map", "nodes", ["map_id"])
    op.create_table(
        "links",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("map_id", sa.String(length=36), nullable=False),
        sa.Column("source_node_id", sa.String(length=36), nullable=False),
        sa.Column("target_node_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.CheckConstraint("kind IN ('local','virtual')", name="ck_links_kind"),
        sa.CheckConstraint("source_node_id <> target_node_id", name="ck_links_distinct_nodes"),
        sa.ForeignKeyConstraint(["map_id"], ["maps.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_node_id"], ["nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_node_id"], ["nodes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("map_id", "source_node_id", "target_node_id", "kind", name="uq_links_pair_kind"),
    )
    op.create_index("ix_links_map", "links", ["map_id"])
    op.create_table(
        "monitors",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("node_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("target_ipv4", sa.String(length=15), nullable=False),
        sa.Column("port", sa.Integer(), nullable=True),
        sa.Column("scheme", sa.String(length=5), nullable=True),
        sa.Column("path", sa.String(length=2048), nullable=True),
        sa.Column("host_header", sa.String(length=255), nullable=True),
        sa.Column("verify_tls", sa.Boolean(), nullable=False),
        sa.Column("interval_seconds", sa.Integer(), nullable=False),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.CheckConstraint("kind IN ('icmp','tcp','http')", name="ck_monitors_kind"),
        sa.CheckConstraint("port IS NULL OR port BETWEEN 1 AND 65535", name="ck_monitors_port"),
        sa.CheckConstraint("interval_seconds BETWEEN 5 AND 3600", name="ck_monitors_interval"),
        sa.CheckConstraint("timeout_seconds BETWEEN 1 AND 30", name="ck_monitors_timeout"),
        sa.CheckConstraint("scheme IS NULL OR scheme IN ('http','https')", name="ck_monitors_scheme"),
        sa.ForeignKeyConstraint(["node_id"], ["nodes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_monitors_node", "monitors", ["node_id"])
    op.create_table(
        "monitor_results",
        sa.Column("monitor_id", sa.String(length=36), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("checked_at", sa.String(length=40), nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(length=80), nullable=True),
        sa.Column("error_message", sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(["monitor_id"], ["monitors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("monitor_id"),
    )


def downgrade() -> None:
    op.drop_table("monitor_results")
    op.drop_index("ix_monitors_node", table_name="monitors")
    op.drop_table("monitors")
    op.drop_index("ix_links_map", table_name="links")
    op.drop_table("links")
    op.drop_index("ix_nodes_map", table_name="nodes")
    op.drop_table("nodes")
    op.drop_table("maps")
