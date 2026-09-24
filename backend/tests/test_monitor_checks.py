from __future__ import annotations

import asyncio

import pytest
from app.monitoring.checks import MonitorCheck, run_check


def check(kind: str, **overrides) -> MonitorCheck:
    values = {
        "monitor_id": "local-test",
        "kind": kind,
        "enabled": True,
        "target_ipv4": "127.0.0.1",
        "port": None,
        "scheme": None,
        "path": None,
        "host_header": None,
        "verify_tls": True,
        "interval_seconds": 30,
        "timeout_seconds": 1,
    }
    values.update(overrides)
    return MonitorCheck(**values)


async def _discard_connection(_reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    writer.close()
    await writer.wait_closed()


async def _http_response(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter, status: int
) -> None:
    try:
        await reader_read_headers(reader)
        response = f"HTTP/1.1 {status} Test\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        writer.write(response.encode())
        await writer.drain()
    finally:
        writer.close()
        await writer.wait_closed()


async def reader_read_headers(reader: asyncio.StreamReader) -> None:
    while await reader.readline() not in {b"\r\n", b"\n", b""}:
        pass


@pytest.mark.asyncio
async def test_icmp_loopback_succeeds() -> None:
    result = await run_check(check("icmp"))
    assert result.success
    assert result.latency_ms is not None


@pytest.mark.asyncio
async def test_tcp_success_uses_only_loopback() -> None:
    server = await asyncio.start_server(_discard_connection, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        success = await run_check(check("tcp", port=port))
        assert success.success
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_tcp_refusal_is_classified(monkeypatch: pytest.MonkeyPatch) -> None:
    async def refuse_connection(*_args, **_kwargs):
        raise ConnectionRefusedError("local fixture refusal")

    monkeypatch.setattr(asyncio, "open_connection", refuse_connection)
    refused = await run_check(check("tcp", port=1))
    assert not refused.success
    assert refused.error_code == "connection_refused"


@pytest.mark.asyncio
async def test_tcp_timeout_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    never = asyncio.Event()

    async def slow_connect(*_args, **_kwargs):
        await never.wait()

    monkeypatch.setattr(asyncio, "open_connection", slow_connect)
    result = await asyncio.wait_for(run_check(check("tcp", port=1)), timeout=1.5)
    assert not result.success
    assert result.error_code == "timeout"


@pytest.mark.asyncio
async def test_http_success_and_failure_use_local_fixture() -> None:
    async def serve_status(status: int) -> tuple[asyncio.AbstractServer, int]:
        async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
            await _http_response(reader, writer, status)

        server = await asyncio.start_server(handler, "127.0.0.1", 0)
        return server, server.sockets[0].getsockname()[1]

    ok_server, ok_port = await serve_status(302)
    error_server, error_port = await serve_status(503)
    try:
        ok = await run_check(
            check("http", port=ok_port, scheme="http", path="/status", host_header="fixture.local")
        )
        assert ok.success
        assert ok.http_status == 302

        failed = await run_check(check("http", port=error_port, scheme="http", path="/"))
        assert not failed.success
        assert failed.http_status == 503
        assert failed.error_code == "http_status"
    finally:
        ok_server.close()
        error_server.close()
        await ok_server.wait_closed()
        await error_server.wait_closed()


@pytest.mark.asyncio
async def test_http_timeout_is_a_bounded_failure() -> None:
    release = asyncio.Event()

    async def slow_handler(_reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            await release.wait()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(slow_handler, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        result = await asyncio.wait_for(
            run_check(check("http", port=port, scheme="http", timeout_seconds=1)), timeout=1.5
        )
        assert not result.success
        assert result.error_code == "timeout"
    finally:
        release.set()
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_https_rejects_non_tls_local_endpoint() -> None:
    server = await asyncio.start_server(_discard_connection, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        result = await run_check(check("http", port=port, scheme="https", timeout_seconds=1))
        assert not result.success
        assert result.error_code == "tls_error"
    finally:
        server.close()
        await server.wait_closed()
