from __future__ import annotations

import asyncio
import threading
from pathlib import Path
from uuid import uuid4

import pytest
from app.db import Database
from app.models import Map, Monitor, MonitorResult, Node
from app.monitoring.checks import CheckOutcome
from app.monitoring.scheduler import MonitorScheduler
from sqlalchemy import select


def make_database(path: Path, monitor_count: int = 1) -> tuple[Database, list[str]]:
    database = Database(f"sqlite:///{path}")
    database.migrate()
    map_id = str(uuid4())
    node_id = str(uuid4())
    monitor_ids = [str(uuid4()) for _ in range(monitor_count)]
    with database.session() as session:
        session.add(Map(id=map_id, name="Fixture", viewport_x=0, viewport_y=0, viewport_zoom=1))
        session.add(
            Node(
                id=node_id,
                map_id=map_id,
                name="Local fixture",
                kind="service",
                x=0,
                y=0,
            )
        )
        for monitor_id in monitor_ids:
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
    return database, monitor_ids


async def wait_until(predicate, timeout: float = 2.0) -> None:
    async def poll() -> None:
        while not predicate():
            await asyncio.sleep(0.01)

    await asyncio.wait_for(poll(), timeout=timeout)


@pytest.mark.asyncio
async def test_reconciliation_failure_retries_and_scheduler_recovers_work(
    tmp_path: Path,
) -> None:
    database, (monitor_id,) = make_database(tmp_path / "reconcile-recovery.db")
    scheduled_started = asyncio.Event()
    manual_started = asyncio.Event()
    database_reads_available = threading.Event()
    recovery_observed = threading.Event()
    failure_lock = threading.Lock()
    failure_count = 0
    calls = 0

    async def checker(_check):
        nonlocal calls
        calls += 1
        if calls == 1:
            scheduled_started.set()
        elif calls == 2:
            manual_started.set()
        return CheckOutcome(True, 1.0)

    scheduler = MonitorScheduler(
        database,
        checker=checker,
        concurrency=1,
        poll_seconds=0.005,
        reconcile_seconds=0.02,
    )
    load_monitors = scheduler._load_enabled_monitors

    def flaky_load_monitors():
        nonlocal failure_count
        if not database_reads_available.is_set():
            with failure_lock:
                failure_count += 1
            raise RuntimeError("fixture database read unavailable")
        with failure_lock:
            failed_before_recovery = failure_count > 0
        if failed_before_recovery:
            recovery_observed.set()
        return load_monitors()

    def failed_twice() -> bool:
        with failure_lock:
            return failure_count >= 2

    scheduler._load_enabled_monitors = flaky_load_monitors
    try:
        await scheduler.start()
        assert scheduler.is_healthy()
        await wait_until(failed_twice)
        assert scheduler._loop_task is not None
        assert not scheduler._loop_task.done()

        database_reads_available.set()
        await wait_until(recovery_observed.is_set)
        await asyncio.wait_for(scheduled_started.wait(), timeout=1)

        await scheduler.run_now(monitor_id)
        await asyncio.wait_for(manual_started.wait(), timeout=1)
        assert calls == 2
    finally:
        database_reads_available.set()
        await scheduler.stop()
        database.dispose()


@pytest.mark.asyncio
async def test_manual_run_coalesces_while_active_and_saves_latest_result(tmp_path: Path) -> None:
    database, (monitor_id,) = make_database(tmp_path / "manual.db")
    first_started = asyncio.Event()
    release_first = asyncio.Event()
    second_started = asyncio.Event()
    release_second = asyncio.Event()
    calls = 0

    async def checker(_check):
        nonlocal calls
        calls += 1
        if calls == 1:
            first_started.set()
            await release_first.wait()
            return CheckOutcome(False, 1.0, error_code="timeout", error_message="Timed out")
        second_started.set()
        await release_second.wait()
        return CheckOutcome(
            False,
            2.0,
            error_code="connection_refused",
            error_message="Refused",
        )

    scheduler = MonitorScheduler(database, checker=checker, concurrency=1)
    try:
        await scheduler.start()
        await asyncio.wait_for(first_started.wait(), timeout=1)
        entry = scheduler._entries[monitor_id]
        next_periodic = entry.next_run
        receipt = await scheduler.run_now(monitor_id)
        coalesced = await scheduler.run_now(monitor_id)
        assert receipt == coalesced
        assert receipt.status == "queued"
        assert calls == 1
        assert entry.next_run == next_periodic

        release_first.set()
        await asyncio.wait_for(second_started.wait(), timeout=1)
        # The prior periodic check has completed. Its failure is not evidence
        # that the later manual request has completed.
        assert (await scheduler.get_manual_run(monitor_id, receipt.run_id)).status == "queued"
        release_second.set()
        deadline = asyncio.get_running_loop().time() + 1
        receipt_status = "queued"
        while asyncio.get_running_loop().time() < deadline:
            receipt_status = (await scheduler.get_manual_run(monitor_id, receipt.run_id)).status
            if receipt_status == "completed":
                break
            await asyncio.sleep(0.01)
        assert receipt_status == "completed"
        await wait_until(lambda: _result_success(database, monitor_id) is False)
        assert calls == 2
    finally:
        release_first.set()
        release_second.set()
        await scheduler.stop()
        database.dispose()


@pytest.mark.asyncio
async def test_completed_manual_receipts_are_evicted_before_rejecting_new_work(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    database, (monitor_id,) = make_database(tmp_path / "manual-receipt-limit.db")
    monkeypatch.setattr("app.monitoring.scheduler.MANUAL_RUN_RECEIPT_LIMIT", 1)

    async def checker(_check):
        return CheckOutcome(True, 1.0)

    scheduler = MonitorScheduler(
        database,
        checker=checker,
        concurrency=1,
        poll_seconds=0.005,
        reconcile_seconds=0.02,
    )
    try:
        await scheduler.start()
        await wait_until(lambda: _result_success(database, monitor_id) is True)
        first = await scheduler.run_now(monitor_id)
        deadline = asyncio.get_running_loop().time() + 1
        while asyncio.get_running_loop().time() < deadline:
            if (await scheduler.get_manual_run(monitor_id, first.run_id)).status == "completed":
                break
            await asyncio.sleep(0.01)
        assert (await scheduler.get_manual_run(monitor_id, first.run_id)).status == "completed"

        second = await scheduler.run_now(monitor_id)
        assert second.run_id != first.run_id
        assert second.status == "queued"
    finally:
        await scheduler.stop()
        database.dispose()


def _result_success(database: Database, monitor_id: str) -> bool | None:
    with database.session() as session:
        result = session.get(MonitorResult, monitor_id)
        return result.success if result else None


@pytest.mark.asyncio
async def test_configuration_change_cancels_old_run_and_reschedules(tmp_path: Path) -> None:
    database, (monitor_id,) = make_database(tmp_path / "reschedule.db")
    first_started = asyncio.Event()
    first_cancelled = asyncio.Event()
    updated_started = asyncio.Event()
    release_first = asyncio.Event()

    async def checker(check):
        if check.target_ipv4 == "127.0.0.1":
            first_started.set()
            try:
                await release_first.wait()
            except asyncio.CancelledError:
                first_cancelled.set()
                raise
        updated_started.set()
        return CheckOutcome(True, 0.5)

    scheduler = MonitorScheduler(database, checker=checker, concurrency=1)
    try:
        await scheduler.start()
        await asyncio.wait_for(first_started.wait(), timeout=1)
        with database.session() as session:
            monitor = session.get(Monitor, monitor_id)
            assert monitor is not None
            monitor.target_ipv4 = "127.0.0.2"
            monitor.interval_seconds = 45
            session.commit()
        await scheduler.refresh()
        await asyncio.wait_for(first_cancelled.wait(), timeout=1)
        await asyncio.wait_for(updated_started.wait(), timeout=1)
        await wait_until(lambda: _result_success(database, monitor_id) is True)
        with database.session() as session:
            result = session.scalar(
                select(MonitorResult).where(MonitorResult.monitor_id == monitor_id)
            )
            assert result is not None
            assert result.success
    finally:
        release_first.set()
        await scheduler.stop()
        database.dispose()


@pytest.mark.asyncio
async def test_disabling_monitor_cancels_and_unregisters_it(tmp_path: Path) -> None:
    database, (monitor_id,) = make_database(tmp_path / "disable.db")
    started = asyncio.Event()
    cancelled = asyncio.Event()
    wait_forever = asyncio.Event()

    async def checker(_check):
        started.set()
        try:
            await wait_forever.wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise
        return CheckOutcome(True, 1.0)

    scheduler = MonitorScheduler(database, checker=checker, concurrency=1)
    try:
        await scheduler.start()
        await asyncio.wait_for(started.wait(), timeout=1)
        with database.session() as session:
            monitor = session.get(Monitor, monitor_id)
            assert monitor is not None
            monitor.enabled = False
            session.commit()
        await scheduler.refresh()
        await asyncio.wait_for(cancelled.wait(), timeout=1)
        await wait_until(lambda: monitor_id not in scheduler._tasks)
        assert monitor_id not in scheduler._entries
        assert _result_success(database, monitor_id) is None
    finally:
        await scheduler.stop()
        database.dispose()


@pytest.mark.asyncio
async def test_concurrency_cap_leaves_capacity_for_other_checks(tmp_path: Path) -> None:
    database, _monitor_ids = make_database(tmp_path / "concurrency.db", monitor_count=3)
    first_started = asyncio.Event()
    second_started = asyncio.Event()
    release_second = asyncio.Event()
    release_first = asyncio.Event()
    calls = 0
    active = 0
    max_active = 0

    async def checker(_check):
        nonlocal calls, active, max_active
        calls += 1
        ordinal = calls
        active += 1
        max_active = max(max_active, active)
        try:
            if ordinal == 1:
                first_started.set()
                await release_first.wait()
            else:
                second_started.set()
                if ordinal == 2:
                    await release_second.wait()
            return CheckOutcome(True, 1.0)
        finally:
            active -= 1

    scheduler = MonitorScheduler(database, checker=checker, concurrency=2)
    try:
        await scheduler.start()
        await asyncio.wait_for(first_started.wait(), timeout=1)
        await asyncio.wait_for(second_started.wait(), timeout=1)
        assert not release_first.is_set()
        assert max_active == 2
        assert calls == 2

        release_second.set()
        await wait_until(lambda: calls == 3)
        assert not release_first.is_set()
        assert max_active <= 2
        release_first.set()
    finally:
        release_first.set()
        await scheduler.stop()
        database.dispose()


@pytest.mark.asyncio
async def test_monitors_keep_independent_interval_schedules(tmp_path: Path) -> None:
    database, monitor_ids = make_database(tmp_path / "intervals.db", monitor_count=2)
    with database.session() as session:
        session.get(Monitor, monitor_ids[0]).interval_seconds = 5
        session.get(Monitor, monitor_ids[1]).interval_seconds = 17
        session.commit()
    completed = 0
    all_completed = asyncio.Event()

    async def checker(_check):
        nonlocal completed
        completed += 1
        if completed == 2:
            all_completed.set()
        return CheckOutcome(True, 0.5)

    scheduler = MonitorScheduler(database, checker=checker, concurrency=2)
    try:
        await scheduler.start()
        await asyncio.wait_for(all_completed.wait(), timeout=1)
        first = scheduler._entries[monitor_ids[0]]
        second = scheduler._entries[monitor_ids[1]]
        assert 11 < abs(first.next_run - second.next_run) < 13
        assert {first.check.interval_seconds, second.check.interval_seconds} == {5, 17}
    finally:
        await scheduler.stop()
        database.dispose()
