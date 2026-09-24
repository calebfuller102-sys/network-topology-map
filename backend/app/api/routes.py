from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import ApiError
from ..models import Link, Map, Monitor, Node
from ..monitoring.scheduler import SchedulerUnavailableError
from ..schemas import (
    LinkCreate,
    LinkOut,
    LinkPatch,
    ManualRunOut,
    MapOut,
    MapPatch,
    MapSnapshot,
    MonitorCreate,
    MonitorFields,
    MonitorOut,
    MonitorPatch,
    NodeCreate,
    NodeOut,
    NodePatch,
    PositionPatch,
)
from ..services import monitor_out, node_status
from ..time import utc_iso

router = APIRouter(prefix="/api/v1")


def _map_or_404(db: Session, map_id: str) -> Map:
    item = db.get(Map, map_id)
    if item is None:
        raise ApiError(404, "map_not_found", "Map was not found")
    return item


def _node_or_404(db: Session, node_id: str) -> Node:
    item = db.get(Node, node_id)
    if item is None:
        raise ApiError(404, "node_not_found", "Node was not found")
    return item


def _link_or_404(db: Session, link_id: str) -> Link:
    item = db.get(Link, link_id)
    if item is None:
        raise ApiError(404, "link_not_found", "Link was not found")
    return item


def _monitor_or_404(db: Session, monitor_id: str) -> Monitor:
    item = db.get(Monitor, monitor_id)
    if item is None:
        raise ApiError(404, "monitor_not_found", "Monitor was not found")
    return item


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(
            409, "conflict", "The requested change conflicts with existing data"
        ) from exc


def _touch(item: Map | Node | Monitor) -> None:
    item.updated_at = utc_iso()


async def _refresh_scheduler(request: Request) -> None:
    scheduler = request.app.state.scheduler
    if scheduler is not None:
        await scheduler.refresh()


@router.get("/maps", response_model=list[MapOut])
def list_maps(db: Session = Depends(get_db)) -> list[Map]:
    return list(db.scalars(select(Map).order_by(Map.name)))


@router.get("/maps/{map_id}", response_model=MapOut)
def get_map(map_id: str, db: Session = Depends(get_db)) -> Map:
    return _map_or_404(db, map_id)


@router.patch("/maps/{map_id}", response_model=MapOut)
def patch_map(map_id: str, payload: MapPatch, db: Session = Depends(get_db)) -> Map:
    item = _map_or_404(db, map_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    _touch(item)
    _commit(db)
    return item


@router.get("/maps/{map_id}/snapshot", response_model=MapSnapshot)
def get_snapshot(map_id: str, db: Session = Depends(get_db)) -> MapSnapshot:
    # Python's SQLite driver does not start a read transaction for SELECT
    # statements in its legacy transaction mode. Start one explicitly so every
    # query below observes the same graph revision instead of mixing rows from
    # a concurrent write into one snapshot response.
    db.execute(text("BEGIN"))
    try:
        item = _map_or_404(db, map_id)
        nodes = list(
            db.scalars(select(Node).where(Node.map_id == map_id).order_by(Node.created_at))
        )
        links = list(
            db.scalars(select(Link).where(Link.map_id == map_id).order_by(Link.created_at))
        )
        monitors_by_node: dict[str, list[Monitor]] = {node.id: [] for node in nodes}
        if nodes:
            monitors = list(
                db.scalars(
                    select(Monitor)
                    .join(Node)
                    .where(Node.map_id == map_id)
                    .order_by(Monitor.created_at)
                )
            )
            for monitor in monitors:
                monitors_by_node.setdefault(monitor.node_id, []).append(monitor)
        else:
            monitors = []
        started_at = db.info["process_started_at"]
        return MapSnapshot(
            map=MapOut.model_validate(item),
            nodes=[NodeOut.model_validate(node) for node in nodes],
            links=[LinkOut.model_validate(link) for link in links],
            monitors=[monitor_out(monitor, started_at) for monitor in monitors],
            statuses=[
                node_status(node.id, monitors_by_node[node.id], started_at) for node in nodes
            ],
        )
    finally:
        db.rollback()


@router.get("/maps/{map_id}/nodes", response_model=list[NodeOut])
def list_nodes(map_id: str, db: Session = Depends(get_db)) -> list[Node]:
    _map_or_404(db, map_id)
    return list(db.scalars(select(Node).where(Node.map_id == map_id).order_by(Node.created_at)))


@router.post("/maps/{map_id}/nodes", response_model=NodeOut, status_code=status.HTTP_201_CREATED)
def create_node(map_id: str, payload: NodeCreate, db: Session = Depends(get_db)) -> Node:
    _map_or_404(db, map_id)
    item = Node(
        id=str(uuid4()),
        map_id=map_id,
        name=payload.name,
        kind=payload.kind,
        icon_id=payload.icon_id,
        ipv4=str(payload.ipv4) if payload.ipv4 else None,
        display_port=payload.display_port,
        x=payload.x,
        y=payload.y,
    )
    db.add(item)
    _commit(db)
    return item


@router.get("/nodes/{node_id}", response_model=NodeOut)
def get_node(node_id: str, db: Session = Depends(get_db)) -> Node:
    return _node_or_404(db, node_id)


@router.patch("/nodes/{node_id}", response_model=NodeOut)
def patch_node(node_id: str, payload: NodePatch, db: Session = Depends(get_db)) -> Node:
    item = _node_or_404(db, node_id)
    values = payload.model_dump(exclude_unset=True)
    if "ipv4" in values:
        values["ipv4"] = str(values["ipv4"]) if values["ipv4"] else None
    for field, value in values.items():
        setattr(item, field, value)
    _touch(item)
    _commit(db)
    return item


@router.patch("/nodes/{node_id}/position", response_model=NodeOut)
def patch_node_position(
    node_id: str, payload: PositionPatch, db: Session = Depends(get_db)
) -> Node:
    item = _node_or_404(db, node_id)
    item.x = payload.x
    item.y = payload.y
    _touch(item)
    _commit(db)
    return item


@router.delete("/nodes/{node_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_node(node_id: str, request: Request, db: Session = Depends(get_db)) -> None:
    item = _node_or_404(db, node_id)
    db.delete(item)
    _commit(db)
    db.close()
    await _refresh_scheduler(request)


@router.get("/maps/{map_id}/links", response_model=list[LinkOut])
def list_links(map_id: str, db: Session = Depends(get_db)) -> list[Link]:
    _map_or_404(db, map_id)
    return list(db.scalars(select(Link).where(Link.map_id == map_id).order_by(Link.created_at)))


@router.post("/maps/{map_id}/links", response_model=LinkOut, status_code=status.HTTP_201_CREATED)
def create_link(map_id: str, payload: LinkCreate, db: Session = Depends(get_db)) -> Link:
    _map_or_404(db, map_id)
    source = _node_or_404(db, payload.source_node_id)
    target = _node_or_404(db, payload.target_node_id)
    if source.map_id != map_id or target.map_id != map_id:
        raise ApiError(409, "cross_map_link", "Both link endpoints must belong to the selected map")
    if source.id == target.id:
        raise ApiError(422, "self_link", "A node cannot link to itself")
    first, second = sorted((source.id, target.id))
    existing = db.scalar(
        select(Link).where(
            Link.map_id == map_id,
            Link.source_node_id == first,
            Link.target_node_id == second,
            Link.kind == payload.kind,
        )
    )
    if existing is not None:
        raise ApiError(409, "duplicate_link", "This link already exists")
    item = Link(
        id=str(uuid4()),
        map_id=map_id,
        source_node_id=first,
        target_node_id=second,
        kind=payload.kind,
    )
    db.add(item)
    _commit(db)
    return item


@router.patch("/links/{link_id}", response_model=LinkOut)
def patch_link(link_id: str, payload: LinkPatch, db: Session = Depends(get_db)) -> Link:
    item = _link_or_404(db, link_id)
    if item.kind != payload.kind:
        duplicate = db.scalar(
            select(Link).where(
                Link.id != item.id,
                Link.map_id == item.map_id,
                Link.source_node_id == item.source_node_id,
                Link.target_node_id == item.target_node_id,
                Link.kind == payload.kind,
            )
        )
        if duplicate is not None:
            raise ApiError(409, "duplicate_link", "This link already exists")
        item.kind = payload.kind
        _commit(db)
    return item


@router.delete("/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_link(link_id: str, db: Session = Depends(get_db)) -> None:
    item = _link_or_404(db, link_id)
    db.delete(item)
    _commit(db)


@router.get("/nodes/{node_id}/monitors", response_model=list[MonitorOut])
def list_monitors(node_id: str, db: Session = Depends(get_db)) -> list[MonitorOut]:
    node = _node_or_404(db, node_id)
    started_at = db.info["process_started_at"]
    monitors = list(
        db.scalars(select(Monitor).where(Monitor.node_id == node.id).order_by(Monitor.created_at))
    )
    return [monitor_out(monitor, started_at) for monitor in monitors]


@router.post(
    "/nodes/{node_id}/monitors", response_model=MonitorOut, status_code=status.HTTP_201_CREATED
)
async def create_monitor(
    node_id: str, payload: MonitorCreate, request: Request, db: Session = Depends(get_db)
) -> MonitorOut:
    _node_or_404(db, node_id)
    item = Monitor(
        id=str(uuid4()),
        node_id=node_id,
        kind=payload.kind,
        enabled=payload.enabled,
        target_ipv4=str(payload.target_ipv4),
        port=payload.port,
        scheme=payload.scheme,
        path=payload.path,
        host_header=payload.host_header,
        verify_tls=payload.verify_tls,
        interval_seconds=payload.interval_seconds,
        timeout_seconds=payload.timeout_seconds,
    )
    db.add(item)
    _commit(db)
    started_at = db.info["process_started_at"]
    response = monitor_out(item, started_at)
    db.close()
    await _refresh_scheduler(request)
    return response


@router.patch("/monitors/{monitor_id}", response_model=MonitorOut)
async def patch_monitor(
    monitor_id: str, payload: MonitorPatch, request: Request, db: Session = Depends(get_db)
) -> MonitorOut:
    item = _monitor_or_404(db, monitor_id)
    values = {field: getattr(item, field) for field in MonitorFields.model_fields}
    values.update(payload.model_dump(exclude_unset=True))
    validated = MonitorFields.model_validate(values)
    for field, value in validated.model_dump().items():
        if field == "target_ipv4":
            value = str(value)
        setattr(item, field, value)
    # Results belong to the exact configuration that produced them. Clear the
    # prior result so a changed target/settings returns to unknown until checked.
    item.result = None
    _touch(item)
    _commit(db)
    started_at = db.info["process_started_at"]
    response = monitor_out(item, started_at)
    db.close()
    await _refresh_scheduler(request)
    return response


@router.delete("/monitors/{monitor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_monitor(
    monitor_id: str, request: Request, db: Session = Depends(get_db)
) -> None:
    item = _monitor_or_404(db, monitor_id)
    db.delete(item)
    _commit(db)
    db.close()
    await _refresh_scheduler(request)


@router.post(
    "/monitors/{monitor_id}/run", response_model=ManualRunOut, status_code=status.HTTP_202_ACCEPTED
)
async def run_monitor_now(
    monitor_id: str, request: Request, db: Session = Depends(get_db)
) -> ManualRunOut:
    monitor = _monitor_or_404(db, monitor_id)
    if not monitor.enabled:
        raise ApiError(409, "monitor_disabled", "A disabled monitor cannot be run")
    db.close()
    scheduler = request.app.state.scheduler
    if scheduler is None:
        raise ApiError(503, "scheduler_unavailable", "Monitor scheduler is unavailable")
    try:
        await scheduler.run_now(monitor_id)
    except SchedulerUnavailableError as exc:
        raise ApiError(503, "scheduler_unavailable", "Monitor scheduler is unavailable") from exc
    except LookupError as exc:
        raise ApiError(409, "monitor_disabled", "Monitor is no longer enabled") from exc
    return ManualRunOut(monitor_id=monitor_id, status="queued")
