"""mcp-use's ``MCPServer`` (a subclass of the official mcp 1.x ``FastMCP``)."""

from __future__ import annotations

import os
from typing import Any

import pytest

os.environ.setdefault("MCP_USE_ANONYMIZED_TELEMETRY", "false")
pytest.importorskip("mcp_use")

from drivers import v1_http  # noqa: E402
from harness import (  # noqa: E402
    JWT,
    PROMPT_NAME,
    RESOURCE_URI,
    TOKEN_HASH,
    Seen,
    assert_batches,
    assert_events_match,
    assert_payloads,
    assert_recorded_once,
    flush_and_get,
    instrument,
    run_scenarios,
    serve_http,
)
from mcp.types import CallToolResult, TextContent  # noqa: E402
from mcp_use.server import MCPServer  # noqa: E402


def add_tools(server: MCPServer) -> None:
    @server.tool()
    def add(a: int, b: int) -> int:
        return a + b

    @server.tool()
    def soft_fail() -> CallToolResult:
        return CallToolResult(content=[TextContent(type="text", text="soft failure")], isError=True)

    @server.tool()
    def boom() -> str:
        raise ValueError("kaboom")

    @server.tool()
    def echo(password: str, text: str) -> str:
        return text


def build_server(*, tools: bool = True) -> MCPServer:
    server = MCPServer(name="analytics-test", version="1.0.0")
    if tools:
        add_tools(server)

    @server.resource(RESOURCE_URI)
    def greeting() -> str:
        return "hello"

    @server.prompt(name=PROMPT_NAME)
    def greet(name: str) -> str:
        return f"Hello {name}"

    return server


def served_like_run(server: MCPServer) -> Any:
    # MCPServer.run() wraps every request handler in its own middleware chain
    # (after instrument() was called) and then serves `server.app`; do the same
    # without binding the server's fixed port.
    server._wrap_handlers_with_middleware()
    return server.app


async def test_streamable_http_after_run_rewraps_handlers(ingest: Any) -> None:
    server = instrument(build_server(), ingest)
    with serve_http(served_like_run(server)) as base:
        async with v1_http(f"{base}/mcp", "client-a", {"Authorization": f"Bearer {JWT}"}) as driver:
            seen = await run_scenarios(driver)
    assert [s.outcome for s in seen[2:6]] == ["success", "tool_error", "tool_error", "tool_error"]
    events = flush_and_get(ingest, len(seen))
    assert_events_match(events, seen, client_name="client-a", transport="streamable-http", token_hash=TOKEN_HASH)
    assert_batches(ingest, "mcp-use")
    assert_recorded_once([e for e in events if e["method"] != "tools/call" or e["target"] == "add"])


async def test_asgi_mount_without_run(ingest: Any) -> None:
    # Serving `server.app` directly skips run() and mcp-use's own middleware;
    # analytics does not depend on it.
    server = instrument(build_server(), ingest)
    with serve_http(server.app) as base:
        async with v1_http(f"{base}/mcp", "client-a") as driver:
            assert await driver.call_tool("add", {"a": 1, "b": 2}) == Seen("tools/call", "add")
    events = flush_and_get(ingest, 2)
    assert_recorded_once(events)


async def test_two_clients_keep_their_identity(ingest: Any) -> None:
    server = instrument(build_server(), ingest)
    with serve_http(served_like_run(server)) as base:
        async with v1_http(f"{base}/mcp", "client-a") as a, v1_http(f"{base}/mcp", "client-b") as b:
            await a.call_tool("add", {"a": 1, "b": 1})
            await b.call_tool("add", {"a": 2, "b": 2})
    events = flush_and_get(ingest, 4)
    calls = {e["client"]["name"]: e["session_id"] for e in events if e["method"] == "tools/call"}
    assert set(calls) == {"client-a", "client-b"} and calls["client-a"] != calls["client-b"]


async def test_gateway_forwarded_requests_are_skipped(ingest: Any) -> None:
    server = instrument(build_server(), ingest)
    with serve_http(served_like_run(server)) as base:
        async with v1_http(f"{base}/mcp", "via-gateway", {"X-Gateway-Request-Id": "req_1"}) as driver:
            await driver.call_tool("add", {"a": 1, "b": 2})
        async with v1_http(f"{base}/mcp", "direct") as driver:
            await driver.call_tool("add", {"a": 1, "b": 2})
    events = flush_and_get(ingest, 2)
    assert {e["client"]["name"] for e in events} == {"direct"}


async def test_payload_capture(capture_ingest: Any) -> None:
    server = instrument(build_server(), capture_ingest)
    with serve_http(served_like_run(server)) as base:
        async with v1_http(f"{base}/mcp", "client-a") as driver:
            await driver.list_tools()
            await driver.call_tool("echo", {"password": "hunter2", "text": "visible"})
    assert_payloads(flush_and_get(capture_ingest, 3))


async def test_payload_capture_off_locally(capture_ingest: Any) -> None:
    server = instrument(build_server(), capture_ingest, capture_payloads=False)
    with serve_http(served_like_run(server)) as base:
        async with v1_http(f"{base}/mcp", "client-a") as driver:
            await driver.call_tool("echo", {"password": "hunter2", "text": "visible"})
    events = flush_and_get(capture_ingest, 2)
    assert events and all("request_payload" not in e for e in events)


async def test_instrument_twice_and_late_tools(ingest: Any) -> None:
    server = build_server(tools=False)
    instrument(server, ingest)
    instrument(server, ingest)
    add_tools(server)
    with serve_http(served_like_run(server)) as base:
        async with v1_http(f"{base}/mcp", "client-a") as driver:
            # tools/list first: mcp-use's run() wrappers break the SDK's own
            # tool-cache refresh (`request_handlers[ListToolsRequest](None)`), so
            # an uncached tools/call fails there with or without analytics.
            await driver.list_tools()
            assert await driver.call_tool("add", {"a": 1, "b": 2}) == Seen("tools/call", "add")
    events = flush_and_get(ingest, 3)
    assert_recorded_once(events)
