from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .db import Database
from .models import MapEvent
from .time import utc_iso

# This is a handoff journal, not an audit log. It bridges a snapshot to its
# SSE subscription and gives short-lived clients a chance to replay a gap.
EVENT_HISTORY_LIMIT = 256
SUBSCRIBER_BUFFER_LIMIT = 64


@dataclass(frozen=True, slots=True)
class TopologyEvent:
    map_id: str
    revision: int
    kind: str

    def as_dict(self) -> dict[str, str | int]:
        return {"map_id": self.map_id, "revision": self.revision, "type": self.kind}


@dataclass(frozen=True, slots=True)
class EventReplay:
    events: list[TopologyEvent]
    resync_required: bool
    latest_revision: int


def append_event(session: Session, map_id: str, kind: str) -> TopologyEvent:
    """Append an event in the caller's mutation transaction.

    Callers publish the returned event only after the transaction commits. A
    failed mutation therefore cannot appear on SSE, while a committed mutation
    remains replayable even if the process crashes before its in-memory fanout.
    """
    item = MapEvent(map_id=map_id, kind=kind, created_at=utc_iso())
    session.add(item)
    session.flush()
    _trim_history(session, map_id)
    return TopologyEvent(map_id=map_id, revision=item.id, kind=kind)


def snapshot_revision(session: Session, map_id: str) -> int:
    return session.scalar(select(func.max(MapEvent.id)).where(MapEvent.map_id == map_id)) or 0


def load_event_replay(database: Database, map_id: str, after: int) -> EventReplay:
    """Read the bounded journal after a client cursor.

    If trimming has made a cursor too old, do not return a partial sequence:
    tell the client to obtain a complete snapshot instead.
    """
    with database.session() as session:
        earliest_revision = session.scalar(
            select(func.min(MapEvent.id)).where(MapEvent.map_id == map_id)
        )
        latest_revision = snapshot_revision(session, map_id)
        if earliest_revision is not None and after < earliest_revision - 1:
            return EventReplay([], True, latest_revision)
        rows = session.scalars(
            select(MapEvent)
            .where(MapEvent.map_id == map_id, MapEvent.id > after)
            .order_by(MapEvent.id)
        ).all()
        return EventReplay(
            [TopologyEvent(map_id=item.map_id, revision=item.id, kind=item.kind) for item in rows],
            False,
            latest_revision,
        )


def _trim_history(session: Session, map_id: str) -> None:
    stale_ids = list(
        session.scalars(
            select(MapEvent.id)
            .where(MapEvent.map_id == map_id)
            .order_by(MapEvent.id.desc())
            .offset(EVENT_HISTORY_LIMIT)
        )
    )
    if stale_ids:
        session.execute(delete(MapEvent).where(MapEvent.id.in_(stale_ids)))


class EventBroker:
    """A lifespan-owned, bounded in-memory fanout for committed events."""

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[TopologyEvent]]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()

    async def stop(self) -> None:
        self._subscribers.clear()
        self._loop = None

    async def publish(self, event: TopologyEvent) -> None:
        self._publish_nowait(event)

    def publish_threadsafe(self, event: TopologyEvent) -> None:
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._publish_nowait, event)

    @asynccontextmanager
    async def subscribe(self, map_id: str) -> AsyncIterator[asyncio.Queue[TopologyEvent]]:
        queue: asyncio.Queue[TopologyEvent] = asyncio.Queue(maxsize=SUBSCRIBER_BUFFER_LIMIT)
        self._subscribers[map_id].add(queue)
        try:
            yield queue
        finally:
            subscribers = self._subscribers.get(map_id)
            if subscribers is not None:
                subscribers.discard(queue)
                if not subscribers:
                    self._subscribers.pop(map_id, None)

    def _publish_nowait(self, event: TopologyEvent) -> None:
        for queue in tuple(self._subscribers.get(event.map_id, ())):
            if not queue.full():
                queue.put_nowait(event)
                continue
            # A slow client must recover from a snapshot rather than block a
            # scheduler or receive a silently truncated topology sequence.
            while not queue.empty():
                queue.get_nowait()
            queue.put_nowait(
                TopologyEvent(event.map_id, event.revision, "resync.required")
            )
