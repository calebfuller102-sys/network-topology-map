from __future__ import annotations

import asyncio
import errno
import platform
import socket
import ssl
import time
from dataclasses import dataclass

import httpx


@dataclass(frozen=True, slots=True)
class MonitorCheck:
    monitor_id: str
    kind: str
    enabled: bool
    target_ipv4: str
    port: int | None
    scheme: str | None
    path: str | None
    host_header: str | None
    verify_tls: bool
    interval_seconds: int
    timeout_seconds: int


@dataclass(frozen=True, slots=True)
class CheckOutcome:
    success: bool
    latency_ms: float | None
    http_status: int | None = None
    error_code: str | None = None
    error_message: str | None = None


def _latency_ms(started: float) -> float:
    return round(max(0.0, (time.monotonic() - started) * 1000), 3)


def _failure(
    code: str, message: str, started: float, http_status: int | None = None
) -> CheckOutcome:
    return CheckOutcome(
        success=False,
        latency_ms=_latency_ms(started),
        http_status=http_status,
        error_code=code,
        error_message=message[:500],
    )


def _has_cause(error: BaseException, kinds: tuple[type[BaseException], ...]) -> bool:
    pending = [error]
    seen: set[int] = set()
    while pending:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, kinds):
            return True
        if current.__cause__ is not None:
            pending.append(current.__cause__)
        if current.__context__ is not None:
            pending.append(current.__context__)
    return False


async def _icmp(check: MonitorCheck) -> CheckOutcome:
    started = time.monotonic()
    if platform.system() == "Windows":
        command = ["ping", "-n", "1", "-w", str(check.timeout_seconds * 1000), check.target_ipv4]
    else:
        command = ["ping", "-n", "-c", "1", "-W", str(check.timeout_seconds), check.target_ipv4]
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except FileNotFoundError:
        return _failure("icmp_unavailable", "The system ping utility is unavailable", started)
    except OSError:
        return _failure("icmp_error", "The ICMP check could not be started", started)

    try:
        # Bound the whole process even if the platform's ping timeout is not honored.
        await asyncio.wait_for(process.communicate(), timeout=check.timeout_seconds)
    except TimeoutError:
        process.kill()
        await process.communicate()
        return _failure("timeout", "ICMP check timed out", started)
    except asyncio.CancelledError:
        if process.returncode is None:
            process.kill()
            await process.communicate()
        raise
    except OSError:
        return _failure("icmp_error", "The ICMP check failed", started)

    if process.returncode == 0:
        return CheckOutcome(success=True, latency_ms=_latency_ms(started))
    return _failure("unreachable", "No ICMP reply was received", started)


async def _tcp(check: MonitorCheck) -> CheckOutcome:
    started = time.monotonic()
    writer: asyncio.StreamWriter | None = None
    try:
        async with asyncio.timeout(check.timeout_seconds):
            _reader, writer = await asyncio.open_connection(check.target_ipv4, check.port)
        # A successful TCP handshake is the check outcome. Closing is best
        # effort and must not turn a live listener into a timeout result.
        writer.close()
        return CheckOutcome(success=True, latency_ms=_latency_ms(started))
    except TimeoutError:
        return _failure("timeout", "TCP connection timed out", started)
    except OSError as exc:
        # The API only accepts IPv4 input, so this is defensive handling for a
        # malformed or imported legacy configuration.  It still lets the
        # diagnostics UI explain the actual transport failure precisely.
        if _has_cause(exc, (socket.gaierror,)):
            return _failure("dns_error", "The monitor target could not be resolved", started)
        if isinstance(exc, ConnectionRefusedError) or exc.errno in {errno.ECONNREFUSED, 10061}:
            return _failure("connection_refused", "TCP connection was refused", started)
        if exc.errno in {errno.ENETUNREACH, errno.EHOSTUNREACH, 10051, 10065}:
            return _failure("unreachable", "TCP target is unreachable", started)
        return _failure("connection_error", "TCP connection failed", started)


async def _http(check: MonitorCheck) -> CheckOutcome:
    started = time.monotonic()
    scheme = check.scheme or "http"
    url = f"{scheme}://{check.target_ipv4}:{check.port}{check.path or '/'}"
    headers = {"Host": check.host_header} if check.host_header else None
    timeout = httpx.Timeout(check.timeout_seconds)
    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=False,
            verify=check.verify_tls,
            trust_env=False,
        ) as client:
            # A wall-clock deadline bounds slow/trickling responses as well as
            # each individual httpx connect/read operation. Do not download bodies.
            async with asyncio.timeout(check.timeout_seconds):
                async with client.stream("GET", url, headers=headers) as response:
                    status_code = response.status_code
        if 200 <= status_code < 400:
            return CheckOutcome(
                success=True,
                latency_ms=_latency_ms(started),
                http_status=status_code,
            )
        return _failure(
            "http_status",
            f"HTTP endpoint returned status {status_code}",
            started,
            status_code,
        )
    except (TimeoutError, httpx.TimeoutException):
        return _failure("timeout", "HTTP request timed out", started)
    except httpx.ConnectError as exc:
        if _has_cause(exc, (socket.gaierror,)):
            return _failure("dns_error", "The monitor target could not be resolved", started)
        if _has_cause(exc, (ssl.SSLError,)):
            return _failure("tls_error", "HTTPS certificate validation failed", started)
        if _has_cause(exc, (ConnectionRefusedError,)):
            return _failure("connection_refused", "HTTP connection was refused", started)
        cause = exc.__cause__
        if isinstance(cause, OSError) and cause.errno in {errno.ECONNREFUSED, 10061}:
            return _failure("connection_refused", "HTTP connection was refused", started)
        return _failure("connection_error", "HTTP connection failed", started)
    except httpx.RequestError as exc:
        if _has_cause(exc, (socket.gaierror,)):
            return _failure("dns_error", "The monitor target could not be resolved", started)
        return _failure("request_error", "HTTP request failed", started)
    except (ValueError, ssl.SSLError):
        return _failure("tls_error", "HTTPS certificate validation failed", started)


async def run_check(check: MonitorCheck) -> CheckOutcome:
    """Run one validated monitor configuration with a strict wall-clock bound."""
    if not check.enabled:
        return _failure("disabled", "Monitor is disabled", time.monotonic())
    try:
        if check.kind == "icmp":
            return await _icmp(check)
        if check.kind == "tcp":
            return await _tcp(check)
        if check.kind == "http":
            return await _http(check)
    except asyncio.CancelledError:
        raise
    except Exception:
        # Do not persist exception text: it may contain target details or headers.
        return CheckOutcome(
            success=False,
            latency_ms=None,
            error_code="check_error",
            error_message="Monitor check failed",
        )
    return CheckOutcome(
        success=False,
        latency_ms=None,
        error_code="invalid_check",
        error_message="Monitor check configuration is invalid",
    )
