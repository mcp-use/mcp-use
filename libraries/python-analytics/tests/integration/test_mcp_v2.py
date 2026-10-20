"""Official ``mcp`` 2.x: the low-level ``Server`` and ``MCPServer``, handshake era and 2026-07-28."""

from __future__ import annotations

from typing import Any

import pytest

pytest.importorskip("mcp")
from drivers import MCP_MAJOR, v2_http, v2_memory  # noqa: E402

if MCP_MAJOR != 2:
    pytest.skip("mcp 2.x only", allow_module_level=True)

import mcp.types as types  # noqa: E402
from harness import (  # noqa: E402
    JWT,
    NAMED_JWT,
    PROMPT_NAME,
    RESOURCE_URI,
    TOKEN_HASH,
    Seen,
    assert_batches,
    assert_dashboard_change_reaches_the_next_batch,
    assert_events_match,
    assert_payloads,
    assert_recorded_once,
    flush_and_get,
    instrument,
    run_scenarios,
    serve_http,
)
from mcp.server.lowlevel import Server  # noqa: E402
from mcp.server.mcpserver import MCPServer  # noqa: E402
from mcp.shared.exceptions import MCPError  # noqa: E402

TOOLS = ["add", "soft_fail", "boom", "echo"]


def build_lowlevel() -> Server:
    async def list_tools(ctx: Any, params: Any) -> types.ListToolsResult:
        return types.ListToolsResult(tools=[types.Tool(name=name, input_schema={"type": "object"}) for name in TOOLS])

    async def call_tool(ctx: Any, params: types.CallToolRequestParams) -> types.CallToolResult:
        arguments = params.arguments or {}
        if params.name == "add":
            return types.CallToolResult(
                content=[types.TextContent(type="text", text=str(arguments["a"] + arguments["b"]))]
            )
        if params.name == "soft_fail":
            return types.CallToolResult(content=[types.TextContent(type="text", text="soft failure")], is_error=True)
        if params.name == "boom":
            raise ValueError("kaboom")
        if params.name == "echo":
            return types.CallToolResult(content=[types.TextContent(type="text", text=arguments["text"])])
        raise MCPError(code=-32602, message=f"Unknown tool: {params.name}")

    async def read_resource(ctx: Any, params: types.ReadResourceRequestParams) -> types.ReadResourceResult:
        if str(params.uri) != RESOURCE_URI:
            raise MCPError(code=-32002, message="Resource not found")
        return types.ReadResourceResult(contents=[types.TextResourceContents(uri=RESOURCE_URI, text="hello")])

    async def get_prompt(ctx: Any, params: types.GetPromptRequestParams) -> types.GetPromptResult:
        text = f"Hello {(params.arguments or {}).get('name')}"
        return types.GetPromptResult(
            messages=[types.PromptMessage(role="user", content=types.TextContent(type="text", text=text))]
        )

    return Server(
        "analytics-test",
        version="1.0.0",
        on_list_tools=list_tools,
        on_call_tool=call_tool,
        on_read_resource=read_resource,
        on_get_prompt=get_prompt,
    )


def add_tools(mcp: MCPServer) -> None:
    @mcp.tool()
    def add(a: int, b: int) -> int:
        return a + b

    @mcp.tool()
    def soft_fail() -> types.CallToolResult:
        return types.CallToolResult(content=[types.TextContent(type="text", text="soft failure")], is_error=True)

    @mcp.tool()
    def boom() -> str:
        raise ValueError("kaboom")

    @mcp.tool()
    def echo(password: str, text: str) -> str:
        return text


def build_mcpserver(*, tools: bool = True) -> MCPServer:
    mcp = MCPServer("analytics-test")
    if tools:
        add_tools(mcp)

    @mcp.resource(RESOURCE_URI)
    def greeting() -> str:
        return "hello"

    @mcp.prompt(name=PROMPT_NAME)
    def greet(name: str) -> str:
        return f"Hello {name}"

    return mcp


async def test_lowlevel_http_handshake(ingest: Any) -> None:
    server = instrument(build_lowlevel(), ingest)
    with serve_http(server.streamable_http_app()) as base:
        async with v2_http(f"{base}/mcp", "client-a", {"Authorization": f"Bearer {JWT}"}) as driver:
            seen = await run_scenarios(driver)
    assert seen[4:6] == [Seen("tools/call", "boom", "error", 0), Seen("tools/call", "nope", "error", -32602)]
    events = flush_and_get(ingest, len(seen))
    mine = assert_events_match(events, seen, client_name="client-a", transport="streamable-http", token_hash=TOKEN_HASH)
    assert_batches(ingest, "mcp-sdk-v2")
    nope = next(e for e in mine if e.get("target") == "nope")
    assert nope["error"] == {"code": -32602, "message": "Unknown tool: nope"}


async def test_mcpserver_http_handshake(ingest: Any) -> None:
    mcp = instrument(build_mcpserver(), ingest)
    with serve_http(mcp.streamable_http_app()) as base:
        async with v2_http(f"{base}/mcp", "client-a", {"Authorization": f"Bearer {JWT}"}) as driver:
            seen = await run_scenarios(driver)
    assert [s.outcome for s in seen[3:6]] == ["tool_error", "tool_error", "tool_error"]
    events = flush_and_get(ingest, len(seen))
    assert_events_match(events, seen, client_name="client-a", transport="streamable-http", token_hash=TOKEN_HASH)
    assert_batches(ingest, "mcp-sdk-v2")


async def test_mcpserver_stateless_http(ingest: Any) -> None:
    mcp = instrument(build_mcpserver(), ingest)
    with serve_http(mcp.streamable_http_app(stateless_http=True)) as base:
        async with v2_http(f"{base}/mcp", "client-a") as driver:
            seen = await run_scenarios(driver)
    events = flush_and_get(ingest, len(seen))
    assert_events_match(events, seen, client_name=None, transport="streamable-http", stateless=True)


async def test_modern_protocol_identifies_the_client_per_request(ingest: Any) -> None:
    # 2026-07-28 has no initialize: client identity rides every request's _meta.
    mcp = instrument(build_mcpserver(), ingest)
    with serve_http(mcp.streamable_http_app()) as base:
        async with v2_http(f"{base}/mcp", "modern-client", mode="auto") as driver:
            await driver.list_tools()
            await driver.call_tool("add", {"a": 1, "b": 2})
    events = flush_and_get(ingest, 2)
    call = next(e for e in events if e["method"] == "tools/call")
    assert call["client"]["name"] == "modern-client"
    assert call["protocol_version"].startswith("2026")
    assert call["stateless"] is True and "initialize" not in {e["method"] for e in events}


async def test_two_clients_keep_their_identity(ingest: Any) -> None:
    mcp = instrument(build_mcpserver(), ingest)
    with serve_http(mcp.streamable_http_app()) as base:
        async with v2_http(f"{base}/mcp", "client-a") as a, v2_http(f"{base}/mcp", "client-b") as b:
            await a.call_tool("add", {"a": 1, "b": 1})
            await b.call_tool("add", {"a": 2, "b": 2})
    events = flush_and_get(ingest, 4)
    calls = {e["client"]["name"]: e["session_id"] for e in events if e["method"] == "tools/call"}
    assert set(calls) == {"client-a", "client-b"} and calls["client-a"] != calls["client-b"]
    init_sessions = {e["client"]["name"]: e["session_id"] for e in events if e["method"] == "initialize"}
    assert init_sessions == calls


async def test_gateway_forwarded_requests_are_skipped(ingest: Any) -> None:
    mcp = instrument(build_mcpserver(), ingest)
    with serve_http(mcp.streamable_http_app()) as base:
        async with v2_http(f"{base}/mcp", "via-gateway", {"X-Gateway-Request-Id": "req_1"}) as driver:
            await driver.call_tool("add", {"a": 1, "b": 2})
        async with v2_http(f"{base}/mcp", "direct") as driver:
            await driver.call_tool("add", {"a": 1, "b": 2})
    events = flush_and_get(ingest, 2)
    assert {e["client"]["name"] for e in events} == {"direct"}


async def test_payload_capture(capture_ingest: Any) -> None:
    mcp = instrument(build_mcpserver(), capture_ingest)
    with serve_http(mcp.streamable_http_app()) as base:
        async with v2_http(f"{base}/mcp", "client-a") as driver:
            await driver.list_tools()
            await driver.call_tool("echo", {"password": "hunter2", "text": "visible"})
    assert_payloads(flush_and_get(capture_ingest, 3))


async def test_dashboard_change_reaches_the_next_batch(ingest: Any, config_clock: Any) -> None:
    mcp = instrument(build_mcpserver(), ingest)
    with serve_http(mcp.streamable_http_app()) as base:
        async with v2_http(f"{base}/mcp", "client-a", {"Authorization": f"Bearer {NAMED_JWT}"}) as driver:
            await assert_dashboard_change_reaches_the_next_batch(ingest, config_clock, driver)


async def test_payload_capture_off_locally(capture_ingest: Any) -> None:
    mcp = instrument(build_mcpserver(), capture_ingest, capture_payloads=False)
    with serve_http(mcp.streamable_http_app()) as base:
        async with v2_http(f"{base}/mcp", "client-a") as driver:
            await driver.call_tool("echo", {"password": "hunter2", "text": "visible"})
    events = flush_and_get(capture_ingest, 2)
    assert events and all("request_payload" not in e for e in events)


async def test_in_process_client(ingest: Any) -> None:
    mcp = instrument(build_mcpserver(), ingest)
    async with v2_memory(mcp, "memory-client") as driver:
        seen = await run_scenarios(driver)
    events = flush_and_get(ingest, len(seen))
    assert_events_match(events, seen, client_name="memory-client", transport="stdio", stateless=None)


async def test_instrument_twice_and_late_tools(ingest: Any) -> None:
    mcp = build_mcpserver(tools=False)
    instrument(mcp, ingest)
    instrument(mcp, ingest)
    instrument(mcp._lowlevel_server, ingest)
    add_tools(mcp)
    async with v2_memory(mcp, "client-a") as driver:
        assert (await driver.call_tool("add", {"a": 1, "b": 2})).outcome == "success"
    events = flush_and_get(ingest, 2)
    assert_recorded_once(events)
    assert mcp._lowlevel_server.middleware[0].__class__.__name__ == "AnalyticsMiddleware"


async def test_in_process_modern_protocol_keeps_one_session(ingest: Any) -> None:
    mcp = instrument(build_mcpserver(), ingest)
    async with v2_memory(mcp, "modern-memory", mode="auto") as driver:
        await driver.call_tool("add", {"a": 1, "b": 2})
        await driver.call_tool("add", {"a": 3, "b": 4})
    events = [e for e in flush_and_get(ingest, 2) if e["method"] == "tools/call"]
    assert len(events) == 2 and len({e["session_id"] for e in events}) == 1
    assert all(e["client"]["name"] == "modern-memory" and e["transport"] == "stdio" for e in events)


async def test_nested_in_process_server_is_recorded_once(ingest: Any) -> None:
    from mcp import Client

    inner = instrument(build_mcpserver(), ingest)
    outer = MCPServer("analytics-test")

    @outer.tool()
    async def via_inner() -> str:
        async with Client(inner, mode="legacy", cache=None) as client:
            result = await client.call_tool("add", {"a": 1, "b": 2})
        return str(result.content[0].text)

    instrument(outer, ingest)
    async with v2_memory(outer, "client-a") as driver:
        assert (await driver.call_tool("via_inner", {})).outcome == "success"
    events = flush_and_get(ingest, 2)
    assert {e["client"]["name"] for e in events} == {"client-a"}, events
    events = [e for e in events if e["method"] != "tools/list"]  # the client's own output-schema refresh
    assert sorted((e["method"], e.get("target")) for e in events) == [("initialize", None), ("tools/call", "via_inner")]
