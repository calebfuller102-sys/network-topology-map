from __future__ import annotations

from threading import Lock
from uuid import uuid4

from app.main import create_app
from app.models import Link, Node
from fastapi.testclient import TestClient
from sqlalchemy import event


def test_snapshot_uses_one_sqlite_read_revision(tmp_path) -> None:
    """A write between snapshot queries must not create a dangling link response."""
    app = create_app(
        f"sqlite:///{tmp_path / 'snapshot-consistency.db'}", start_monitor_scheduler=False
    )
    with TestClient(app) as client:
        map_id = client.get("/api/v1/maps").json()[0]["id"]
        source_id = client.post(
            f"/api/v1/maps/{map_id}/nodes",
            json={"name": "Source", "kind": "device", "x": 0, "y": 0},
        ).json()["id"]
        state = {"inserted": False}
        guard = Lock()

        def insert_between_snapshot_queries(
            _connection, _cursor, statement, _parameters, _context, _executemany
        ) -> None:
            if state["inserted"] or "FROM nodes" not in statement:
                return
            with guard:
                if state["inserted"]:
                    return
                state["inserted"] = True
                target_id = str(uuid4())
                with app.state.db.session() as writer:
                    writer.add(
                        Node(
                            id=target_id,
                            map_id=map_id,
                            name="Added after node query",
                            kind="device",
                            x=1,
                            y=1,
                        )
                    )
                    writer.flush()
                    writer.add(
                        Link(
                            id=str(uuid4()),
                            map_id=map_id,
                            source_node_id=source_id,
                            target_node_id=target_id,
                            kind="local",
                        )
                    )
                    writer.commit()

        event.listen(
            app.state.db.engine,
            "after_cursor_execute",
            insert_between_snapshot_queries,
        )
        try:
            snapshot = client.get(f"/api/v1/maps/{map_id}/snapshot")
        finally:
            event.remove(
                app.state.db.engine,
                "after_cursor_execute",
                insert_between_snapshot_queries,
            )

    assert state["inserted"]
    assert snapshot.status_code == 200
    body = snapshot.json()
    assert [node["id"] for node in body["nodes"]] == [source_id]
    assert body["links"] == []
