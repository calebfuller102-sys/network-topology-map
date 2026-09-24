from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.models import Monitor, MonitorResult
from app.services import node_status


def monitor(monitor_id: str, *, enabled: bool = True, result: bool | None = None) -> Monitor:
    item = Monitor(
        id=monitor_id,
        node_id="node",
        kind="tcp",
        enabled=enabled,
        target_ipv4="127.0.0.1",
        port=80,
        verify_tls=True,
        interval_seconds=30,
        timeout_seconds=3,
    )
    if result is not None:
        item.result = MonitorResult(
            monitor_id=monitor_id,
            success=result,
            checked_at=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            latency_ms=1,
        )
    return item


def test_derived_statuses_cover_missing_stale_and_mixed_results() -> None:
    started = datetime.now(UTC)
    assert node_status("node", [], started).status == "unknown"
    assert node_status("node", [monitor("pending")], started).status == "unknown"
    assert node_status("node", [monitor("disabled", enabled=False)], started).status == "unknown"

    assert node_status("node", [monitor("up", result=True)], started).status == "online"
    assert node_status("node", [monitor("down", result=False)], started).status == "offline"
    assert (
        node_status("node", [monitor("up", result=True), monitor("down", result=False)], started)
        .status
        == "degraded"
    )
    stale = monitor("stale", result=True)
    assert stale.result is not None
    stale.result.checked_at = (started - timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
    stale_summary = node_status("node", [stale], started)
    assert stale_summary.status == "unknown"
    assert stale_summary.monitors[0].stale
