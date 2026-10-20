"""Community ``fastmcp`` (PrefectHQ/jlowin): 2.x and 3.x run on mcp 1.x, 4.x on mcp 2.x."""

from __future__ import annotations

from importlib import metadata
from typing import Any

import pytest

fastmcp = pytest.importorskip("fastmcp")

from drivers import MCP_MAJOR, v1_http, v2_http  # noqa: E402
from fastmcp import FastMCP  # noqa: E402
from fastmcp.exceptions import ToolError  # noqa: E402
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

FASTMCP_MAJOR = int(metadata.version("fastmcp").split(".")[0])
connect = v2_http if MCP_MAJOR == 2 else v1_http


def add_tools(mcp: FastMCP) -> None:
    @mcp.tool
    def add(a: int, b: int) -> int:
        return a + b

    @mcp.tool
    def soft_fail():  # no annotation: old fastmcp cannot resolve postponed ones here
        if FASTMCP_MAJOR >= 3:
            from fastmcp.tools.tool import ToolResult
            from mcp.types import TextContent

            return ToolResult(content=[TextContent(type="text", text="soft failure")], is_error=True)
        raise ToolError("soft failure")  # fastmcp 2 reports tool errors only by raising

    @mcp.tool
    def boom() -> str:
        raise ValueError("kaboom")

    @mcp.tool
    def echo(password: str, text: str) -> str:
        return text


def build_server(*, tools: bool = True) -> FastMCP:
    mcp = FastMCP("analytics-test")
    if tools:
        add_tools(mcp)

    @mcp.resource(RESOURCE_URI)
    def greeting() -> str:
        return "hello"

    @mcp.prompt(name=PROMPT_NAME)
    def greet(name: str) -> str:
        return f"Hello {name}"

    return mcp


def test_versions_under_test() -> None:
    # Make the matrix visible in the test log.
    print(f"fastmcp {metadata.version('fastmcp')} on mcp {metadata.version('mcp')}")
    assert (FASTMCP_MAJOR >= 4) == (MCP_MAJOR == 2)


async def test_streamable_http_stateful(ingest: Any) -> None:
    mcp = instrument(build_server(), ingest)
    with serve_http(mcp.http_app(path="/mcp")) as base:
        async with connect(f"{base}/mcp", "client-a", {"Authorization": f"Bearer {JWT}"}) as driver:
            seen = await run_scenarios(driver)
            seen.append(await driver.read_resource("res://missing"))
    assert [s.outcome for s in seen[2:6]] == ["success", "tool_error", "tool_error", "tool_error"]
    assert seen[-1].outcome == "error"
    events = flush_and_get(ingest, len(seen))
    assert_events_match(events, seen, client_name="client-a", transport="streamable-http", token_hash=TOKEN_HASH)
    assert_batches(ingest, "fastmcp")
    assert ingest.batches[0]["sdk"]["framework_version"] == metadata.version("fastmcp")


async def test_stateless_http(ingest: Any) -> None:
    mcp = instrument(build_server(), ingest)
    with serve_http(mcp.http_app(path="/mcp", stateless_http=True)) as base:
        async with connect(f"{base}/mcp", "client-a") as driver:
            seen = await run_scenarios(driver)
    events = flush_and_get(ingest, len(seen))
    assert_events_match(events, seen, client_name=None, transport="streamable-http", stateless=True)


async def test_two_clients_keep_their_identity(ingest: Any) -> None:
    mcp = instrument(build_server(), ingest)
    with serve_http(mcp.http_app(path="/mcp")) as base:
        async with connect(f"{base}/mcp", "client-a") as a, connect(f"{base}/mcp", "client-b") as b:
            await a.call_tool("add", {"a": 1, "b": 1})
            await b.call_tool("add", {"a": 2, "b": 2})
    events = flush_and_get(ingest, 4)
    calls = {e["client"]["name"]: e["session_id"] for e in events if e["method"] == "tools/call"}
    assert set(calls) == {"client-a", "client-b"} and calls["client-a"] != calls["client-b"]


async def test_gateway_forwarded_requests_are_skipped(ingest: Any) -> None:
    mcp = instrument(build_server(), ingest)
    with serve_http(mcp.http_app(path="/mcp")) as base:
        async with connect(f"{base}/mcp", "via-gateway", {"X-Gateway-Request-Id": "req_1"}) as driver:
            await driver.call_tool("add", {"a": 1, "b": 2})
        async with connect(f"{base}/mcp", "direct") as driver:
            await driver.call_tool("add", {"a": 1, "b": 2})
    events = flush_and_get(ingest, 2)
    assert {e["client"]["name"] for e in events} == {"direct"}


async def test_payload_capture(capture_ingest: Any) -> None:
    mcp = instrument(build_server(), capture_ingest)
    with serve_http(mcp.http_app(path="/mcp")) as base:
        async with connect(f"{base}/mcp", "client-a") as driver:
            await driver.list_tools()
            await driver.call_tool("echo", {"password": "hunter2", "text": "visible"})
    assert_payloads(flush_and_get(capture_ingest, 3))


async def test_payload_capture_off_locally(capture_ingest: Any) -> None:
    mcp = instrument(build_server(), capture_ingest, capture_payloads=False)
    with serve_http(mcp.http_app(path="/mcp")) as base:
        async with connect(f"{base}/mcp", "client-a") as driver:
            await driver.call_tool("echo", {"password": "hunter2", "text": "visible"})
    events = flush_and_get(capture_ingest, 2)
    assert events and all("request_payload" not in e for e in events)


async def test_in_memory_fastmcp_client(ingest: Any) -> None:
    from fastmcp import Client
    from mcp.types import Implementation

    mcp = instrument(build_server(), ingest)
    async with Client(mcp, client_info=Implementation(name="fastmcp-memory", version="1.0.0")) as client:
        await client.call_tool("add", {"a": 1, "b": 2})
        with pytest.raises(ToolError):
            await client.call_tool("boom", {})
    events = flush_and_get(ingest, 2)
    calls = sorted((e for e in events if e["method"] == "tools/call"), key=lambda e: e["time"])
    assert [(e["target"], e["outcome"]) for e in calls] == [("add", "success"), ("boom", "tool_error")]
    assert all(e["transport"] == "stdio" and e["session_id"] for e in calls)
    assert {e["client"]["name"] for e in calls} == {"fastmcp-memory"}


async def test_instrument_twice_and_late_tools(ingest: Any) -> None:
    mcp = build_server(tools=False)
    instrument(mcp, ingest)
    instrument(mcp, ingest)
    instrument(mcp._mcp_server, ingest)
    add_tools(mcp)
    with serve_http(mcp.http_app(path="/mcp")) as base:
        async with connect(f"{base}/mcp", "client-a") as driver:
            assert await driver.call_tool("add", {"a": 1, "b": 2}) == Seen("tools/call", "add")
    events = flush_and_get(ingest, 2)
    assert_recorded_once(events)


@pytest.mark.skipif(MCP_MAJOR != 2, reason="the 2026-07-28 protocol needs mcp 2.x")
async def test_modern_protocol(ingest: Any) -> None:
    mcp = instrument(build_server(), ingest)
    with serve_http(mcp.http_app(path="/mcp")) as base:
        async with v2_http(f"{base}/mcp", "modern-client", mode="auto") as driver:
            await driver.call_tool("add", {"a": 1, "b": 2})
    events = flush_and_get(ingest, 1)
    call = next(e for e in events if e["method"] == "tools/call")
    assert call["client"]["name"] == "modern-client" and call["protocol_version"].startswith("2026")
