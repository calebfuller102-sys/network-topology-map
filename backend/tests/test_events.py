from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import uuid4

import pytest
from app.api.routes import _stream_map_events
from app.db import Database
from app.events import EventBroker, TopologyEvent, load_event_replay
from app.main import create_app
from app.models import Map, Monitor, Node
from app.monitoring.checks import CheckOutcome
from app.monitoring.scheduler import MonitorScheduler
from fastapi.testclient import TestClient


class RequestStub:
    def __init__(self, app) -> None:
        self.app = app

    async def is_disconnected(self) -> bool:
        return False


def test_snapshot_cursor_replays_mutation_during_handoff(tmp_path: Path) -> None:
    """A write after the snapshot and before SSE attach is retained in the journal."""
    app = create_app(f"sqlite:///{tmp_path / 'handoff.db'}", start_monitor_scheduler=False)
    with TestClient(app) as client:
        map_id = client.get("/api/v1/maps").json()[0]["id"]
        snapshot = client.get(f"/api/v1/maps/{map_id}/snapshot").json()
        node = client.post(
            f"/api/v1/maps/{map_id}/nodes",
            json={"name": "Created in handoff gap", "kind": "service", "x": 1, "y": 2},
        )
        assert node.status_code == 201

        replay = load_event_replay(app.state.db, map_id, snapshot["revision"])
        assert replay.resync_required is False
        assert [(event.revision, event.kind) for event in replay.events] == [
            (snapshot["revision"] + 1, "topology.changed")
        ]

        async def read_replay() -> list[str]:
            stream = _stream_map_events(
                RequestStub(app), map_id, snapshot["revision"], app.state.event_broker
            )
            try:
                return [await anext(stream), await anext(stream)]
            finally:
                await stream.aclose()

        chunks = asyncio.run(read_replay())
        assert chunks[0] == ": connected\n\n"
        assert "event: topology.changed" in chunks[1]
        assert f'"revision":{snapshot["revision"] + 1}' in chunks[1]


def test_event_endpoint_sets_sse_headers(tmp_path: Path) -> None:
    app = create_app(f"sqlite:///{tmp_path / 'headers.db'}", start_monitor_scheduler=False)
    with TestClient(app) as client:
        map_id = client.get("/api/v1/maps").json()[0]["id"]
        response = asyncio.run(
            _endpoint_response(app, map_id)
        )
    assert response.media_type == "text/event-stream"
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-accel-buffering"] == "no"


async def _endpoint_response(app, map_id: str):
    from app.api.routes import stream_map_events

    with app.state.db.session() as session:
        return await stream_map_events(
            map_id,
            RequestStub(app),
            after=0,
            db=session,
        )


@pytest.mark.asyncio
async def test_saved_monitor_result_publishes_bounded_status_event(tmp_path: Path) -> None:
    database = Database(f"sqlite:///{tmp_path / 'monitor-event.db'}")
    database.migrate()
    map_id = str(uuid4())
    node_id = str(uuid4())
    monitor_id = str(uuid4())
    with database.session() as session:
        session.add(Map(id=map_id, name="Fixture", viewport_x=0, viewport_y=0, viewport_zoom=1))
        session.add(Node(id=node_id, map_id=map_id, name="Fixture", kind="service", x=0, y=0))
        session.add(
            Monitor(
                id=monitor_id,
                node_id=node_id,
                kind="tcp",
                enabled=True,
                target_ipv4="127.0.0.1",
                port=1,
                verify_tls=True,
                interval_seconds=3600,
                timeout_seconds=2,
            )
        )
        session.commit()

    broker = EventBroker()
    await broker.start()

    async def checker(_check):
        return CheckOutcome(True, 1.0)

    scheduler = MonitorScheduler(
        database,
        checker=checker,
        event_publisher=broker.publish,
        poll_seconds=0.005,
        reconcile_seconds=0.02,
    )
    try:
        async with broker.subscribe(map_id) as events:
            await scheduler.start()
            event = await asyncio.wait_for(events.get(), timeout=1)
        assert event.kind == "status.updated"
        assert event.map_id == map_id
        replay = load_event_replay(database, map_id, event.revision - 1)
        assert replay.events == [event]
    finally:
        await scheduler.stop()
        await broker.stop()
        database.dispose()


@pytest.mark.asyncio
async def test_slow_subscriber_is_told_to_resync() -> None:
    broker = EventBroker()
    await broker.start()
    try:
        async with broker.subscribe("map-a") as events:
            for revision in range(1, 66):
                await broker.publish(TopologyEvent("map-a", revision, "status.updated"))
            event = await events.get()
            assert event == TopologyEvent("map-a", 65, "resync.required")
            assert events.empty()
    finally:
        await broker.stop()
