from __future__ import annotations

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .time import utc_now


class Base(DeclarativeBase):
    pass


def utc_timestamp() -> str:
    return utc_now().isoformat().replace("+00:00", "Z")


class Map(Base):
    __tablename__ = "maps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    viewport_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    viewport_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    viewport_zoom: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=utc_timestamp)
    updated_at: Mapped[str] = mapped_column(String(40), nullable=False, default=utc_timestamp)

    nodes: Mapped[list[Node]] = relationship(
        back_populates="map", cascade="all, delete-orphan", passive_deletes=True
    )
    links: Mapped[list[Link]] = relationship(
        back_populates="map", cascade="all, delete-orphan", passive_deletes=True
    )
    events: Mapped[list[MapEvent]] = relationship(
        back_populates="map", cascade="all, delete-orphan", passive_deletes=True
    )


class MapEvent(Base):
    __tablename__ = "map_events"
    __table_args__ = (Index("ix_map_events_map_revision", "map_id", "id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    map_id: Mapped[str] = mapped_column(ForeignKey("maps.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=utc_timestamp)

    map: Mapped[Map] = relationship(back_populates="events")


class Node(Base):
    __tablename__ = "nodes"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('device','vm','container','kubernetes','service','cloud','other')",
            name="ck_nodes_kind",
        ),
        CheckConstraint(
            "display_port IS NULL OR display_port BETWEEN 1 AND 65535", name="ck_nodes_port"
        ),
        Index("ix_nodes_map", "map_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    map_id: Mapped[str] = mapped_column(ForeignKey("maps.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    icon_id: Mapped[str] = mapped_column(String(100), nullable=False, default="mdi-server")
    ipv4: Mapped[str | None] = mapped_column(String(15), nullable=True)
    display_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=utc_timestamp)
    updated_at: Mapped[str] = mapped_column(String(40), nullable=False, default=utc_timestamp)

    map: Mapped[Map] = relationship(back_populates="nodes")
    monitors: Mapped[list[Monitor]] = relationship(
        back_populates="node", cascade="all, delete-orphan", passive_deletes=True
    )


class Link(Base):
    __tablename__ = "links"
    __table_args__ = (
        CheckConstraint("kind IN ('local','virtual')", name="ck_links_kind"),
        CheckConstraint("source_node_id <> target_node_id", name="ck_links_distinct_nodes"),
        UniqueConstraint(
            "map_id", "source_node_id", "target_node_id", "kind", name="uq_links_pair_kind"
        ),
        Index("ix_links_map", "map_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    map_id: Mapped[str] = mapped_column(ForeignKey("maps.id", ondelete="CASCADE"), nullable=False)
    source_node_id: Mapped[str] = mapped_column(
        ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False
    )
    target_node_id: Mapped[str] = mapped_column(
        ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=utc_timestamp)

    map: Mapped[Map] = relationship(back_populates="links")


class Monitor(Base):
    __tablename__ = "monitors"
    __table_args__ = (
        CheckConstraint("kind IN ('icmp','tcp','http')", name="ck_monitors_kind"),
        CheckConstraint("port IS NULL OR port BETWEEN 1 AND 65535", name="ck_monitors_port"),
        CheckConstraint("interval_seconds BETWEEN 5 AND 3600", name="ck_monitors_interval"),
        CheckConstraint("timeout_seconds BETWEEN 1 AND 30", name="ck_monitors_timeout"),
        CheckConstraint("scheme IS NULL OR scheme IN ('http','https')", name="ck_monitors_scheme"),
        Index("ix_monitors_node", "node_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    node_id: Mapped[str] = mapped_column(ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    target_ipv4: Mapped[str] = mapped_column(String(15), nullable=False)
    port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scheme: Mapped[str | None] = mapped_column(String(5), nullable=True)
    path: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    host_header: Mapped[str | None] = mapped_column(String(255), nullable=True)
    verify_tls: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=utc_timestamp)
    updated_at: Mapped[str] = mapped_column(String(40), nullable=False, default=utc_timestamp)

    node: Mapped[Node] = relationship(back_populates="monitors")
    result: Mapped[MonitorResult | None] = relationship(
        back_populates="monitor", uselist=False, cascade="all, delete-orphan", passive_deletes=True
    )


class MonitorResult(Base):
    __tablename__ = "monitor_results"

    monitor_id: Mapped[str] = mapped_column(
        ForeignKey("monitors.id", ondelete="CASCADE"), primary_key=True
    )
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    checked_at: Mapped[str] = mapped_column(String(40), nullable=False)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)

    monitor: Mapped[Monitor] = relationship(back_populates="result")
