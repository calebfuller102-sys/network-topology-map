from __future__ import annotations

import math
import re
from ipaddress import IPv4Address
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .icon_manifest import ICON_IDS

REMOTE_MDI_ICON_ID = re.compile(r"mdi-[a-z0-9]+(?:-[a-z0-9]+)*\Z")

NodeKind = Literal["device", "vm", "container", "kubernetes", "service", "cloud", "other"]
LinkKind = Literal["local", "virtual"]
MonitorKind = Literal["icmp", "tcp", "http"]
HttpScheme = Literal["http", "https"]
Status = Literal["unknown", "online", "degraded", "offline"]
ManualRunStatus = Literal["queued", "completed", "unavailable"]

def _finite(value: float | None) -> float | None:
    if value is None:
        return value
    if not math.isfinite(value):
        raise ValueError("must be a finite number")
    return value


def _hyperlink(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if any(character.isspace() for character in value):
        raise ValueError("must not contain whitespace")
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("must be an absolute http or https URL")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("must not include credentials")
    return value


def _icon_id(value: str) -> str:
    value = value.strip().lower()
    if value not in ICON_IDS and REMOTE_MDI_ICON_ID.fullmatch(value) is None:
        raise ValueError("icon_id must be a bundled icon or a valid mdi- identifier")
    return value


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MapPatch(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    viewport_x: float | None = None
    viewport_y: float | None = None
    viewport_zoom: float | None = None

    _finite_x = field_validator("viewport_x", "viewport_y", "viewport_zoom")(_finite)

    @model_validator(mode="after")
    def has_change(self) -> MapPatch:
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        for field in ("viewport_x", "viewport_y", "viewport_zoom"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        if self.viewport_zoom is not None and self.viewport_zoom <= 0:
            raise ValueError("viewport_zoom must be greater than zero")
        if self.name is not None:
            self.name = self.name.strip()
            if not self.name:
                raise ValueError("name must not be blank")
        return self


class MapOut(StrictModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: str
    name: str
    viewport_x: float
    viewport_y: float
    viewport_zoom: float
    created_at: str
    updated_at: str


class NodeCreate(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    kind: NodeKind
    icon_id: str = Field(default="mdi-server", min_length=1, max_length=100)
    hyperlink: str | None = Field(default=None, max_length=2048)
    ipv4: IPv4Address | None = None
    display_port: Annotated[int | None, Field(ge=1, le=65535)] = None
    x: float
    y: float

    _finite_position = field_validator("x", "y")(_finite)

    @field_validator("name")
    @classmethod
    def non_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("icon_id")
    @classmethod
    def valid_icon_id(cls, value: str) -> str:
        return _icon_id(value)

    _valid_hyperlink = field_validator("hyperlink")(_hyperlink)


class NodePatch(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: NodeKind | None = None
    icon_id: str | None = Field(default=None, min_length=1, max_length=100)
    hyperlink: str | None = Field(default=None, max_length=2048)
    ipv4: IPv4Address | None = None
    display_port: Annotated[int | None, Field(ge=1, le=65535)] = None
    x: float | None = None
    y: float | None = None

    _finite_position = field_validator("x", "y")(_finite)

    @field_validator("name")
    @classmethod
    def non_blank(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("icon_id")
    @classmethod
    def valid_icon_id(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return _icon_id(value)

    _valid_hyperlink = field_validator("hyperlink")(_hyperlink)

    @model_validator(mode="after")
    def has_change(self) -> NodePatch:
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        for field in ("name", "kind", "icon_id", "x", "y"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class PositionPatch(StrictModel):
    x: float
    y: float

    _finite_position = field_validator("x", "y")(_finite)


class NodeOut(StrictModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: str
    map_id: str
    name: str
    kind: NodeKind
    icon_id: str
    hyperlink: str | None
    ipv4: str | None
    display_port: int | None
    x: float
    y: float
    created_at: str
    updated_at: str


class LinkCreate(StrictModel):
    source_node_id: str
    target_node_id: str
    kind: LinkKind


class LinkPatch(StrictModel):
    kind: LinkKind


class LinkOut(StrictModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: str
    map_id: str
    source_node_id: str
    target_node_id: str
    kind: LinkKind
    created_at: str


class MonitorFields(StrictModel):
    kind: MonitorKind
    enabled: bool = True
    target_ipv4: IPv4Address
    port: Annotated[int | None, Field(ge=1, le=65535)] = None
    scheme: HttpScheme | None = None
    path: str | None = Field(default=None, max_length=2048)
    host_header: str | None = Field(default=None, max_length=255)
    verify_tls: bool = True
    interval_seconds: Annotated[int, Field(ge=5, le=3600)] = 30
    timeout_seconds: Annotated[int, Field(ge=1, le=30)] = 3

    @model_validator(mode="after")
    def validate_kind_fields(self) -> MonitorFields:
        auxiliary = (self.scheme, self.path, self.host_header)
        if self.kind == "icmp":
            if (
                self.port is not None
                or any(value is not None for value in auxiliary)
                or not self.verify_tls
            ):
                raise ValueError("ICMP checks only accept target_ipv4 and scheduling fields")
        elif self.kind == "tcp":
            if self.port is None:
                raise ValueError("TCP checks require port")
            if any(value is not None for value in auxiliary) or not self.verify_tls:
                raise ValueError("TCP checks do not accept HTTP fields")
        else:
            if self.port is None or self.scheme is None:
                raise ValueError("HTTP checks require scheme and port")
            if self.path is None:
                self.path = "/"
            if not self.path.startswith("/"):
                raise ValueError("HTTP path must start with '/'")
            if "\r" in (self.host_header or "") or "\n" in (self.host_header or ""):
                raise ValueError("host_header must not contain line breaks")
            if self.scheme == "http" and not self.verify_tls:
                raise ValueError("verify_tls=false is only valid for HTTPS checks")
        return self


class MonitorCreate(MonitorFields):
    pass


class MonitorPatch(StrictModel):
    kind: MonitorKind | None = None
    enabled: bool | None = None
    target_ipv4: IPv4Address | None = None
    port: Annotated[int | None, Field(ge=1, le=65535)] = None
    scheme: HttpScheme | None = None
    path: str | None = Field(default=None, max_length=2048)
    host_header: str | None = Field(default=None, max_length=255)
    verify_tls: bool | None = None
    interval_seconds: Annotated[int | None, Field(ge=5, le=3600)] = None
    timeout_seconds: Annotated[int | None, Field(ge=1, le=30)] = None

    @model_validator(mode="after")
    def has_change(self) -> MonitorPatch:
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        if "host_header" in self.model_fields_set and self.host_header is not None:
            if "\r" in self.host_header or "\n" in self.host_header:
                raise ValueError("host_header must not contain line breaks")
        if (
            "path" in self.model_fields_set
            and self.path is not None
            and not self.path.startswith("/")
        ):
            raise ValueError("HTTP path must start with '/'")
        return self


class MonitorResultOut(StrictModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    monitor_id: str
    success: bool
    checked_at: str
    latency_ms: float | None
    http_status: int | None
    error_code: str | None
    error_message: str | None
    stale: bool


class MonitorOut(StrictModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: str
    node_id: str
    kind: MonitorKind
    enabled: bool
    target_ipv4: str
    port: int | None
    scheme: HttpScheme | None
    path: str | None
    host_header: str | None
    verify_tls: bool
    interval_seconds: int
    timeout_seconds: int
    created_at: str
    updated_at: str
    result: MonitorResultOut | None = None


class MonitorSummary(StrictModel):
    id: str
    kind: MonitorKind
    success: bool | None
    checked_at: str | None
    error_code: str | None
    stale: bool


class NodeStatusOut(StrictModel):
    node_id: str
    status: Status
    monitors: list[MonitorSummary]


class ManualRunOut(StrictModel):
    monitor_id: str
    run_id: str
    status: ManualRunStatus


class MapSnapshot(StrictModel):
    revision: int
    map: MapOut
    nodes: list[NodeOut]
    links: list[LinkOut]
    monitors: list[MonitorOut]
    statuses: list[NodeStatusOut]


class HealthzOut(StrictModel):
    status: Literal["ok"]
