from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime

from .models import Monitor, MonitorResult
from .schemas import MonitorOut, MonitorResultOut, MonitorSummary, NodeStatusOut, Status


def result_is_stale(result: MonitorResult | None, process_started_at: datetime) -> bool:
    if result is None:
        return False
    try:
        checked_at = datetime.fromisoformat(result.checked_at.replace("Z", "+00:00"))
    except ValueError:
        return True
    if checked_at.tzinfo is None:
        checked_at = checked_at.replace(tzinfo=UTC)
    return checked_at < process_started_at


def monitor_out(monitor: Monitor, process_started_at: datetime) -> MonitorOut:
    result = monitor.result
    result_out = None
    if result is not None:
        result_out = MonitorResultOut(
            monitor_id=result.monitor_id,
            success=result.success,
            checked_at=result.checked_at,
            latency_ms=result.latency_ms,
            http_status=result.http_status,
            error_code=result.error_code,
            error_message=result.error_message,
            stale=result_is_stale(result, process_started_at),
        )
    return MonitorOut(
        id=monitor.id,
        node_id=monitor.node_id,
        kind=monitor.kind,
        enabled=monitor.enabled,
        target_ipv4=monitor.target_ipv4,
        port=monitor.port,
        scheme=monitor.scheme,
        path=monitor.path,
        host_header=monitor.host_header,
        verify_tls=monitor.verify_tls,
        interval_seconds=monitor.interval_seconds,
        timeout_seconds=monitor.timeout_seconds,
        created_at=monitor.created_at,
        updated_at=monitor.updated_at,
        result=result_out,
    )


def node_status(
    node_id: str, monitors: Iterable[Monitor], process_started_at: datetime
) -> NodeStatusOut:
    enabled = [monitor for monitor in monitors if monitor.enabled]
    summaries: list[MonitorSummary] = []
    for monitor in enabled:
        result = monitor.result
        stale = result_is_stale(result, process_started_at)
        summaries.append(
            MonitorSummary(
                id=monitor.id,
                kind=monitor.kind,
                success=result.success if result and not stale else None,
                checked_at=result.checked_at if result else None,
                error_code=result.error_code if result and not stale else None,
                stale=stale,
            )
        )
    if not enabled or any(summary.success is None or summary.stale for summary in summaries):
        status: Status = "unknown"
    elif all(summary.success for summary in summaries):
        status = "online"
    elif all(not summary.success for summary in summaries):
        status = "offline"
    else:
        status = "degraded"
    return NodeStatusOut(node_id=node_id, status=status, monitors=summaries)
