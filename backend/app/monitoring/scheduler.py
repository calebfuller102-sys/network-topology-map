from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select

from ..db import Database
from ..models import Monitor, MonitorResult
from ..time import utc_iso
from .checks import CheckOutcome, MonitorCheck, run_check

CheckFunction = Callable[[MonitorCheck], Awaitable[CheckOutcome]]
logger = logging.getLogger(__name__)


class SchedulerUnavailableError(RuntimeError):
    """Raised when no running scheduler can safely accept manual work."""


def _check_from_model(monitor: Monitor) -> MonitorCheck:
    return MonitorCheck(
        monitor_id=monitor.id,
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
    )


@dataclass(slots=True)
class _Entry:
    check: MonitorCheck
    next_run: float
    generation: int
    manual_due: bool = False


class MonitorScheduler:
    """One lifespan-owned scheduler; network work never holds a DB session."""

    def __init__(
        self,
        database: Database,
        *,
        concurrency: int = 8,
        checker: CheckFunction | None = None,
        poll_seconds: float = 0.25,
        reconcile_seconds: float = 5.0,
    ) -> None:
        self.database = database
        self.concurrency = concurrency
        self.checker = checker or run_check
        self.poll_seconds = poll_seconds
        self.reconcile_seconds = reconcile_seconds
        self._entries: dict[str, _Entry] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._wake = asyncio.Event()
        self._lock = asyncio.Lock()
        self._loop_task: asyncio.Task[None] | None = None
        self._stopping = False

    async def start(self) -> None:
        if self._loop_task is not None and not self._loop_task.done():
            return
        self._loop_task = None
        self._stopping = False
        initial_delay = self.reconcile_seconds
        if not await self._reconcile():
            initial_delay = self._initial_retry_delay()
        self._loop_task = asyncio.create_task(
            self._run_loop(initial_delay), name="monitor-scheduler"
        )

    async def stop(self) -> None:
        self._stopping = True
        tasks = list(self._tasks.values())
        if self._loop_task is not None:
            self._loop_task.cancel()
            tasks.append(self._loop_task)
            self._loop_task = None
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        self._entries.clear()

    def is_healthy(self) -> bool:
        task = self._loop_task
        return not self._stopping and task is not None and not task.done()

    async def refresh(self) -> bool:
        """Reconcile after a committed monitor or node mutation."""
        reconciled = await self._reconcile()
        self._wake.set()
        return reconciled

    async def run_now(self, monitor_id: str) -> None:
        if not self.is_healthy():
            raise SchedulerUnavailableError("Monitor scheduler is unavailable")
        if not await self.refresh() or not self.is_healthy():
            raise SchedulerUnavailableError("Monitor scheduler is temporarily unavailable")
        async with self._lock:
            if not self.is_healthy():
                raise SchedulerUnavailableError("Monitor scheduler is unavailable")
            entry = self._entries.get(monitor_id)
            if entry is None:
                raise LookupError("enabled monitor was not found")
            # Coalesce repeated clicks and queue one rerun if a check is active.
            entry.manual_due = True
        self._wake.set()

    async def _sync_monitors(self) -> None:
        configs = await asyncio.to_thread(self._load_enabled_monitors)
        now = asyncio.get_running_loop().time()
        async with self._lock:
            for monitor_id in set(self._entries) - set(configs):
                self._entries.pop(monitor_id, None)
                task = self._tasks.get(monitor_id)
                if task is not None:
                    task.cancel()
            for monitor_id, check in configs.items():
                entry = self._entries.get(monitor_id)
                if entry is None:
                    self._entries[monitor_id] = _Entry(check, now, 1)
                elif entry.check != check:
                    task = self._tasks.get(monitor_id)
                    if task is not None:
                        task.cancel()
                    self._entries[monitor_id] = _Entry(check, now, entry.generation + 1)

    async def _reconcile(self) -> bool:
        try:
            await self._sync_monitors()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Failed to reconcile monitor configuration; retrying")
            return False
        return True

    def _initial_retry_delay(self) -> float:
        return max(0.1, self.poll_seconds, min(self.reconcile_seconds, 1.0))

    def _load_enabled_monitors(self) -> dict[str, MonitorCheck]:
        with self.database.session() as session:
            monitors = session.scalars(select(Monitor).where(Monitor.enabled.is_(True))).all()
            return {monitor.id: _check_from_model(monitor) for monitor in monitors}

    async def _run_loop(self, initial_reconcile_delay: float) -> None:
        loop = asyncio.get_running_loop()
        retry_delay = self._initial_retry_delay()
        reconcile_at = loop.time() + initial_reconcile_delay
        while not self._stopping:
            now = loop.time()
            if now >= reconcile_at:
                if await self._reconcile():
                    retry_delay = self._initial_retry_delay()
                    reconcile_at = loop.time() + self.reconcile_seconds
                else:
                    reconcile_at = loop.time() + retry_delay
                    retry_delay = min(retry_delay * 2, 30.0)
                now = loop.time()
            await self._launch_due(now)

            async with self._lock:
                future_runs = [entry.next_run for entry in self._entries.values()]
                at_capacity = len(self._tasks) >= self.concurrency
            if at_capacity:
                wait_seconds = min(self.poll_seconds, max(0.01, reconcile_at - now))
            else:
                next_due = min(future_runs, default=now + self.poll_seconds)
                wait_seconds = max(0.01, min(self.poll_seconds, next_due - now, reconcile_at - now))
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=wait_seconds)
            except TimeoutError:
                pass

    async def _launch_due(self, now: float) -> None:
        async with self._lock:
            available = self.concurrency - len(self._tasks)
            if available <= 0:
                return
            entries = sorted(self._entries.values(), key=lambda item: item.next_run)
            for entry in entries:
                monitor_id = entry.check.monitor_id
                if available <= 0:
                    break
                if monitor_id in self._tasks:
                    continue
                periodic_due = entry.next_run <= now
                if not periodic_due and not entry.manual_due:
                    continue
                if periodic_due:
                    entry.next_run = now + entry.check.interval_seconds
                entry.manual_due = False
                task = asyncio.create_task(
                    self._execute(entry.check, entry.generation),
                    name=f"monitor-{monitor_id}",
                )
                self._tasks[monitor_id] = task
                available -= 1

    async def _execute(self, check: MonitorCheck, generation: int) -> None:
        current = asyncio.current_task()
        try:
            try:
                outcome = await self.checker(check)
            except asyncio.CancelledError:
                raise
            except Exception:
                outcome = CheckOutcome(
                    success=False,
                    latency_ms=None,
                    error_code="check_error",
                    error_message="Monitor check failed",
                )
            async with self._lock:
                entry = self._entries.get(check.monitor_id)
                is_current = entry is not None and entry.generation == generation
            if is_current and not self._stopping:
                try:
                    await asyncio.to_thread(self._save_result, check, outcome)
                except Exception:
                    logger.exception("Failed to persist result for monitor %s", check.monitor_id)
        finally:
            async with self._lock:
                entry = self._entries.get(check.monitor_id)
                if (
                    entry is not None
                    and entry.generation == generation
                    and entry.next_run <= asyncio.get_running_loop().time()
                ):
                    entry.next_run = (
                        asyncio.get_running_loop().time() + entry.check.interval_seconds
                    )
                if self._tasks.get(check.monitor_id) is current:
                    self._tasks.pop(check.monitor_id, None)
            self._wake.set()

    def _save_result(self, check: MonitorCheck, outcome: CheckOutcome) -> None:
        with self.database.session() as session:
            monitor = session.get(Monitor, check.monitor_id)
            if monitor is None or not monitor.enabled or _check_from_model(monitor) != check:
                return
            result = session.get(MonitorResult, check.monitor_id)
            if result is None:
                result = MonitorResult(monitor_id=check.monitor_id, success=outcome.success)
                session.add(result)
            result.success = outcome.success
            result.checked_at = utc_iso(datetime.now(UTC))
            result.latency_ms = outcome.latency_ms
            result.http_status = outcome.http_status
            result.error_code = outcome.error_code
            result.error_message = outcome.error_message[:500] if outcome.error_message else None
            session.commit()
