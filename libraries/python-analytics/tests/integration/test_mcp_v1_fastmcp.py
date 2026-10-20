"""Official ``mcp`` 1.x ``FastMCP`` over streamable HTTP, stateful and ``stateless_http``."""

from __future__ import annotations

from typing import Any

import pytest

pytest.importorskip("mcp")
from drivers import MCP_MAJOR, v1_http, v1_memory  # noqa: E402

if MCP_MAJOR != 1:
    pytest.skip("mcp 1.x only", allow_module_level=True)

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
from mcp.server.fastmcp import FastMCP  # noqa: E402
from mcp.types import CallToolResult, TextContent  # noqa: E402


def add_tools(mcp: FastMCP) -> None:
    @mcp.tool()
    def add(a: int, b: int) -> int:
        return a + b

    @mcp.tool()
    def soft_fail() -> CallToolResult:
        return CallToolResult(content=[TextContent(type="text", text="soft failure")], isError=True)

    @mcp.tool()
    def boom() -> str:
        raise ValueError("kaboom")

    @mcp.tool()
    def echo(password: str, text: str) -> str:
        return text


def build_server(*, stateless: bool = False, tools: bool = True) -> FastMCP:
    mcp = FastMCP("analytics-test", stateless_http=stateless)
    if tools:
        add_tools(mcp)

    @mcp.resource(RESOURCE_URI)
    def greeting() -> str:
        return "hello"

    @mcp.prompt(name=PROMPT_NAME)
    def greet(name: str) -> str:
        return f"Hello {name}"

    return mcp


EXPECTED = [
    Seen("initialize"),
    Seen("tools/list"),
    Seen("tools/call", "add"),
    Seen("tools/call", "soft_fail", "tool_error"),
    Seen("tools/call", "boom", "tool_error"),
    Seen("tools/call", "nope", "tool_error"),
    Seen("resources/read", RESOURCE_URI),
    Seen("prompts/get", PROMPT_NAME),
]


def assert_expected(seen: list[Seen]) -> None:
    # Older FastMCP releases serialize a returned CallToolResult instead of
    # passing it through, so soft_fail's outcome depends on the mcp version;
    # the events must match what the client saw either way (checked later).
    assert [s for s in seen if s.target != "soft_fail"] == [s for s in EXPECTED if s.target != "soft_fail"]


async def test_streamable_http_stateful(ingest: Any) -> None:
    mcp = instrument(build_server(), ingest)
    with serve_http(mcp.streamable_http_app()) as base:
        async with v1_http(f"{base}/mcp", "client-a", {"Authorization": f"Bearer {JWT}"}) as driver:
            seen = await run_scenarios(driver)
            seen.append(await driver.read_resource("res://missing"))
    assert_expected(seen[:-1])
    assert seen[-1] == Seen("resources/read", "res://missing", "error", 0)
    events = flush_and_get(ingest, len(seen))
    assert_events_match(events, seen, client_name="client-a", transport="streamable-http", token_hash=TOKEN_HASH)
    assert_batches(ingest, "mcp-sdk-v1")


async def test_stateless_http(ingest: Any) -> None:
    mcp = instrument(build_server(stateless=True), ingest)
    with serve_http(mcp.streamable_http_app()) as base:
        async with v1_http(f"{base}/mcp", "client-a") as driver:
            seen = await run_scenarios(driver)
    assert_expected(seen)
    events = flush_and_get(ingest, len(seen))
    assert_events_match(events, seen, client_name=None, transport="streamable-http", stateless=True)


async def test_two_clients_keep_their_identity(ingest: Any) -> None:
    mcp = instrument(build_server(), ingest)
    with serve_http(mcp.streamable_http_app()) as base:
        async with v1_http(f"{base}/mcp", "client-a") as a, v1_http(f"{base}/mcp", "client-b") as b:
            await a.call_tool("add", {"a": 1, "b": 1})
            await b.call_tool("add", {"a": 2, "b": 2})
    events = flush_and_get(ingest, 4)
    calls = {e["client"]["name"]: e["session_id"] for e in events if e["method"] == "tools/call"}
    assert set(calls) == {"client-a", "client-b"} and calls["client-a"] != calls["client-b"]


async def test_gateway_forwarded_requests_are_skipped(ingest: Any) -> None:
    mcp = instrument(build_server(), ingest)
    with serve_http(mcp.streamable_http_app()) as base:
        async with v1_http(f"{base}/mcp", "via-gateway", {"X-Gateway-Request-Id": "req_1"}) as driver:
            await driver.call_tool("add", {"a": 1, "b": 2})
        async with v1_http(f"{base}/mcp", "direct") as driver:
            await driver.call_tool("add", {"a": 1, "b": 2})
    events = flush_and_get(ingest, 2)
    assert {e["client"]["name"] for e in events} == {"direct"}


async def test_payload_capture(capture_ingest: Any) -> None:
    mcp = instrument(build_server(), capture_ingest)
    with serve_http(mcp.streamable_http_app()) as base:
        async with v1_http(f"{base}/mcp", "client-a") as driver:
            await driver.list_tools()
            await driver.call_tool("echo", {"password": "hunter2", "text": "visible"})
    assert_payloads(flush_and_get(capture_ingest, 3))


async def test_payload_capture_off_locally(capture_ingest: Any) -> None:
    mcp = instrument(build_server(), capture_ingest, capture_payloads=False)
    with serve_http(mcp.streamable_http_app()) as base:
        async with v1_http(f"{base}/mcp", "client-a") as driver:
            await driver.call_tool("echo", {"password": "hunter2", "text": "visible"})
    events = flush_and_get(capture_ingest, 2)
    assert events and all("request_payload" not in e for e in events)


async def test_instrument_twice_and_late_tools(ingest: Any) -> None:
    mcp = build_server(tools=False)
    instrument(mcp, ingest)
    instrument(mcp, ingest)
    instrument(mcp._mcp_server, ingest)  # the low-level server is the same instrumentation target
    add_tools(mcp)
    async with v1_memory(mcp._mcp_server, "client-a") as driver:
        assert (await driver.call_tool("add", {"a": 1, "b": 2})).outcome == "success"
    events = flush_and_get(ingest, 2)
    assert_recorded_once(events)
    assert any(e["method"] == "tools/call" and e["target"] == "add" for e in events)
