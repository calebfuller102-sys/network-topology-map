from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path

from app.main import create_app
from app.models import MonitorResult
from app.monitoring.checks import CheckOutcome
from app.monitoring.scheduler import MonitorScheduler
from fastapi.testclient import TestClient


def make_client(tmp_path: Path) -> TestClient:
    # API contract tests do not need to launch checks against fixture addresses.
    return TestClient(
        create_app(f"sqlite:///{tmp_path / 'test.db'}", start_monitor_scheduler=False)
    )


def test_home_map_is_created_and_snapshot_is_consistent(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        maps = client.get("/api/v1/maps")
        assert maps.status_code == 200
        home = maps.json()[0]
        snapshot = client.get(f"/api/v1/maps/{home['id']}/snapshot")
        assert snapshot.status_code == 200
        assert snapshot.json()["map"]["name"] == "Home"
        assert snapshot.json()["nodes"] == []
        assert snapshot.json()["links"] == []


def test_node_link_and_position_validation(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        map_id = client.get("/api/v1/maps").json()[0]["id"]
        invalid = client.post(
            f"/api/v1/maps/{map_id}/nodes",
            json={"name": "bad", "kind": "device", "ipv4": "10.0.0.270", "x": 0, "y": 0},
        )
        assert invalid.status_code == 422
        invalid_icon = client.post(
            f"/api/v1/maps/{map_id}/nodes",
            json={"name": "bad icon", "kind": "device", "icon_id": "remote-svg", "x": 0, "y": 0},
        )
        assert invalid_icon.status_code == 422
        first = client.post(
            f"/api/v1/maps/{map_id}/nodes",
            json={"name": "Router", "kind": "device", "ipv4": "10.0.0.1", "x": 1, "y": 2},
        ).json()
        second = client.post(
            f"/api/v1/maps/{map_id}/nodes",
            json={"name": "Server", "kind": "service", "x": 3, "y": 4},
        ).json()
        link = client.post(
            f"/api/v1/maps/{map_id}/links",
            json={"source_node_id": second["id"], "target_node_id": first["id"], "kind": "local"},
        )
        assert link.status_code == 201
        duplicate = client.post(
            f"/api/v1/maps/{map_id}/links",
            json={"source_node_id": first["id"], "target_node_id": second["id"], "kind": "local"},
        )
        assert duplicate.status_code == 409
        patched = client.patch(f"/api/v1/links/{link.json()['id']}", json={"kind": "virtual"})
        assert patched.status_code == 200
        assert patched.json()["kind"] == "virtual"
        deleted_link = client.delete(f"/api/v1/links/{link.json()['id']}")
        assert deleted_link.status_code == 204
        moved = client.patch(f"/api/v1/nodes/{first['id']}/position", json={"x": 9, "y": 10})
        assert moved.status_code == 200
        assert moved.json()["x"] == 9
        assert client.patch(f"/api/v1/nodes/{first['id']}", json={"x": None}).status_code == 422
        assert client.patch(
            f"/api/v1/maps/{map_id}", json={"viewport_x": None}
        ).status_code == 422


def test_allowlisted_simple_icon_ids_are_accepted(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        map_id = client.get("/api/v1/maps").json()[0]["id"]
        created = client.post(
            f"/api/v1/maps/{map_id}/nodes",
            json={
                "name": "Container platform",
                "kind": "container",
                "icon_id": "si-docker",
                "x": 0,
                "y": 0,
            },
        )
        assert created.status_code == 201
        rejected = client.patch(
            f"/api/v1/nodes/{created.json()['id']}", json={"icon_id": "si-unlisted"}
        )
        assert rejected.status_code == 422


def test_monitor_semantics_and_aggregate_status(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        map_id = client.get("/api/v1/maps").json()[0]["id"]
        node = client.post(
            f"/api/v1/maps/{map_id}/nodes", json={"name": "Web", "kind": "service", "x": 0, "y": 0}
        ).json()
        invalid = client.post(
            f"/api/v1/nodes/{node['id']}/monitors",
            json={"kind": "tcp", "target_ipv4": "10.0.0.10"},
        )
        assert invalid.status_code == 422
        monitor = client.post(
            f"/api/v1/nodes/{node['id']}/monitors",
            json={
                "kind": "http",
                "target_ipv4": "127.0.0.1",
                "port": 443,
                "scheme": "https",
                "enabled": False,
            },
        )
        assert monitor.status_code == 201
        assert monitor.json()["path"] == "/"
        snapshot = client.get(f"/api/v1/maps/{map_id}/snapshot").json()
        assert snapshot["statuses"][0]["status"] == "unknown"


def test_node_delete_cascades_links_and_monitors(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        map_id = client.get("/api/v1/maps").json()[0]["id"]
        first = client.post(
            f"/api/v1/maps/{map_id}/nodes", json={"name": "A", "kind": "device", "x": 0, "y": 0}
        ).json()
        second = client.post(
            f"/api/v1/maps/{map_id}/nodes", json={"name": "B", "kind": "device", "x": 1, "y": 1}
        ).json()
        client.post(
            f"/api/v1/maps/{map_id}/links",
            json={"source_node_id": first["id"], "target_node_id": second["id"], "kind": "virtual"},
        )
        client.post(
            f"/api/v1/nodes/{first['id']}/monitors",
            json={"kind": "icmp", "target_ipv4": "127.0.0.1", "enabled": False},
        )
        deleted = client.delete(f"/api/v1/nodes/{first['id']}")
        assert deleted.status_code == 204
        snapshot = client.get(f"/api/v1/maps/{map_id}/snapshot").json()
        assert len(snapshot["nodes"]) == 1
        assert snapshot["links"] == []
        assert snapshot["monitors"] == []


def test_repeated_startup_persists_migration_and_stale_result(tmp_path: Path) -> None:
    database_url = f"sqlite:///{tmp_path / 'restart.db'}"
    first_app = create_app(database_url, start_monitor_scheduler=False)
    with TestClient(first_app) as client:
        map_id = client.get("/api/v1/maps").json()[0]["id"]
        node = client.post(
            f"/api/v1/maps/{map_id}/nodes",
            json={"name": "Offline fixture", "kind": "service", "x": 0, "y": 0},
        ).json()
        monitor = client.post(
            f"/api/v1/nodes/{node['id']}/monitors",
            json={"kind": "icmp", "target_ipv4": "127.0.0.1"},
        ).json()
        with first_app.state.db.session() as session:
            session.add(
                MonitorResult(
                    monitor_id=monitor["id"],
                    success=True,
                    checked_at="2000-01-01T00:00:00Z",
                    latency_ms=1,
                )
            )
            session.commit()

    second_app = create_app(database_url, start_monitor_scheduler=False)
    with TestClient(second_app) as client:
        snapshot = client.get(f"/api/v1/maps/{map_id}/snapshot")
        assert snapshot.status_code == 200
        assert snapshot.json()["monitors"][0]["result"]["stale"] is True
        assert snapshot.json()["statuses"][0]["status"] == "unknown"
        with second_app.state.db.engine.connect() as connection:
            revision = connection.exec_driver_sql(
                "SELECT version_num FROM alembic_version"
            ).scalar()
        assert revision == "0002_map_events"


def test_monitor_edit_and_disable_clear_prior_result(tmp_path: Path) -> None:
    app = create_app(
        f"sqlite:///{tmp_path / 'monitor-edit.db'}", start_monitor_scheduler=False
    )
    with TestClient(app) as client:
        map_id = client.get("/api/v1/maps").json()[0]["id"]
        node = client.post(
            f"/api/v1/maps/{map_id}/nodes",
            json={"name": "Fixture", "kind": "service", "x": 0, "y": 0},
        ).json()
        monitor = client.post(
            f"/api/v1/nodes/{node['id']}/monitors",
            json={"kind": "tcp", "target_ipv4": "127.0.0.1", "port": 80},
        ).json()
        with app.state.db.session() as session:
            session.add(
                MonitorResult(
                    monitor_id=monitor["id"],
                    success=True,
                    checked_at="2000-01-01T00:00:00Z",
                    latency_ms=1,
                )
            )
            session.commit()

        changed = client.patch(
            f"/api/v1/monitors/{monitor['id']}", json={"target_ipv4": "127.0.0.2"}
        )
        assert changed.status_code == 200
        assert changed.json()["result"] is None
        disabled = client.patch(f"/api/v1/monitors/{monitor['id']}", json={"enabled": False})
        assert disabled.status_code == 200
        assert disabled.json()["result"] is None
        snapshot = client.get(f"/api/v1/maps/{map_id}/snapshot").json()
        assert snapshot["statuses"][0]["status"] == "unknown"


def test_manual_run_returns_202_and_does_not_wait_for_checker(tmp_path: Path) -> None:
    first_started = threading.Event()
    release_first = threading.Event()
    second_started = threading.Event()
    call_lock = threading.Lock()
    calls = 0

    async def checker(_check):
        nonlocal calls
        with call_lock:
            calls += 1
            call_number = calls
        if call_number == 1:
            first_started.set()
            await asyncio.to_thread(release_first.wait, 5)
            return CheckOutcome(False, 1.0, error_code="timeout", error_message="Timed out")
        second_started.set()
        return CheckOutcome(True, 2.0)

    app = create_app(f"sqlite:///{tmp_path / 'manual-api.db'}", monitor_checker=checker)
    try:
        with TestClient(app) as client:
            map_id = client.get("/api/v1/maps").json()[0]["id"]
            node = client.post(
                f"/api/v1/maps/{map_id}/nodes",
                json={"name": "Loopback", "kind": "service", "x": 0, "y": 0},
            ).json()
            monitor = client.post(
                f"/api/v1/nodes/{node['id']}/monitors",
                json={"kind": "tcp", "target_ipv4": "127.0.0.1", "port": 1},
            ).json()
            assert first_started.wait(1)
            started = time.monotonic()
            response = client.post(f"/api/v1/monitors/{monitor['id']}/run")
            elapsed = time.monotonic() - started
            assert response.status_code == 202
            assert response.json() == {"monitor_id": monitor["id"], "status": "queued"}
            assert elapsed < 1

            release_first.set()
            assert second_started.wait(1)
            deadline = time.monotonic() + 1
            while time.monotonic() < deadline:
                listed = client.get(f"/api/v1/nodes/{node['id']}/monitors").json()[0]
                if listed["result"] and listed["result"]["success"]:
                    break
                time.sleep(0.01)
            assert listed["result"]["success"] is True
    finally:
        release_first.set()


def test_manual_run_returns_503_when_scheduler_is_not_healthy(tmp_path: Path) -> None:
    app = create_app(
        f"sqlite:///{tmp_path / 'manual-unavailable.db'}", start_monitor_scheduler=False
    )
    with TestClient(app) as client:
        map_id = client.get("/api/v1/maps").json()[0]["id"]
        node = client.post(
            f"/api/v1/maps/{map_id}/nodes",
            json={"name": "Fixture", "kind": "service", "x": 0, "y": 0},
        ).json()
        monitor = client.post(
            f"/api/v1/nodes/{node['id']}/monitors",
            json={"kind": "tcp", "target_ipv4": "127.0.0.1", "port": 1},
        ).json()
        app.state.scheduler = MonitorScheduler(app.state.db)

        response = client.post(f"/api/v1/monitors/{monitor['id']}/run")

        assert response.status_code == 503
        assert response.json()["error"]["code"] == "scheduler_unavailable"
