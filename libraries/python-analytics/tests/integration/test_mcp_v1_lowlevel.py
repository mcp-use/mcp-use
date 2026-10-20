"""Official ``mcp`` 1.x low-level ``Server`` over streamable HTTP (stateful and stateless), SSE and memory."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

import pytest

pytest.importorskip("mcp")
from drivers import MCP_MAJOR, v1_http, v1_memory, v1_sse  # noqa: E402

if MCP_MAJOR != 1:
    pytest.skip("mcp 1.x only", allow_module_level=True)

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
from mcp.shared.exceptions import McpError  # noqa: E402
from starlette.applications import Starlette  # noqa: E402
from starlette.routing import Mount  # noqa: E402

TOOLS = ["add", "soft_fail", "boom", "echo"]


def build_server(*, register: bool = True) -> Server:
    server: Server = Server("analytics-test", version="1.0.0")
    if register:
        register_handlers(server)
    return server


def register_handlers(server: Server) -> None:
    @server.list_tools()
    async def list_tools() -> list[types.Tool]:
        return [types.Tool(name=name, inputSchema={"type": "object"}) for name in TOOLS]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> Any:
        if name == "add":
            return [types.TextContent(type="text", text=str(arguments["a"] + arguments["b"]))]
        if name == "soft_fail":
            return types.CallToolResult(content=[types.TextContent(type="text", text="soft failure")], isError=True)
        if name == "boom":
            raise ValueError("kaboom")
        if name == "echo":
            return [types.TextContent(type="text", text=arguments["text"])]
        raise ValueError(f"Unknown tool: {name}")

    @server.read_resource()
    async def read_resource(uri: Any) -> str:
        if str(uri) == RESOURCE_URI:
            return "hello"
        raise McpError(types.ErrorData(code=-32002, message=f"Resource not found: {uri}"))

    @server.get_prompt()
    async def get_prompt(name: str, arguments: dict[str, str] | None) -> types.GetPromptResult:
        text = f"Hello {(arguments or {}).get('name')}"
        return types.GetPromptResult(
            messages=[types.PromptMessage(role="user", content=types.TextContent(type="text", text=text))]
        )


def http_app(server: Server, *, stateless: bool = False) -> Starlette:
    from mcp.server.streamable_http_manager import StreamableHTTPSessionManager

    manager = StreamableHTTPSessionManager(app=server, stateless=stateless)

    async def handle(scope: Any, receive: Any, send: Any) -> None:
        await manager.handle_request(scope, receive, send)

    @asynccontextmanager
    async def lifespan(_: Starlette) -> Any:
        async with manager.run():
            yield

    return Starlette(routes=[Mount("/mcp", app=handle)], lifespan=lifespan)


def sse_app(server: Server) -> Starlette:
    from mcp.server.sse import SseServerTransport
    from starlette.responses import Response
    from starlette.routing import Route

    transport = SseServerTransport("/messages/")

    async def handle_sse(request: Any) -> Response:
        async with transport.connect_sse(request.scope, request.receive, request._send) as (read, write):
            await server.run(read, write, server.create_initialization_options())
        return Response()

    return Starlette(
        routes=[Route("/sse", endpoint=handle_sse), Mount("/messages/", app=transport.handle_post_message)]
    )


SEEN_EXPECTED = [
    Seen("initialize"),
    Seen("tools/list"),
    Seen("tools/call", "add"),
    Seen("tools/call", "soft_fail", "tool_error"),
    Seen("tools/call", "boom", "tool_error"),  # the low-level decorator turns exceptions into isError
    Seen("tools/call", "nope", "tool_error"),
    Seen("resources/read", RESOURCE_URI),
    Seen("prompts/get", PROMPT_NAME),
]


async def test_streamable_http_stateful(ingest: Any) -> None:
    server = instrument(build_server(), ingest)
    with serve_http(http_app(server)) as base:
        async with v1_http(f"{base}/mcp/", "client-a", {"Authorization": f"Bearer {JWT}"}) as driver:
            seen = await run_scenarios(driver)
            seen.append(await driver.read_resource("res://missing"))
    assert seen == SEEN_EXPECTED + [Seen("resources/read", "res://missing", "error", -32002)]
    events = flush_and_get(ingest, len(seen))
    mine = assert_events_match(events, seen, client_name="client-a", transport="streamable-http", token_hash=TOKEN_HASH)
    assert_batches(ingest, "mcp-sdk-v1")
    init = next(e for e in mine if e["method"] == "initialize")
    assert init["client_info"] == {"name": "client-a", "version": "1.0.0"}
    assert init["http"]["path"] == "/mcp/"
    missing = next(e for e in mine if e.get("target") == "res://missing")
    assert missing["error"] == {"code": -32002, "message": "Resource not found: res://missing"}
    assert ingest.batches[0]["server"] == {"name": "analytics-test", "version": "1.0.0"}


async def test_two_clients_keep_their_identity(ingest: Any) -> None:
    server = instrument(build_server(), ingest)
    with serve_http(http_app(server)) as base:
        async with v1_http(f"{base}/mcp/", "client-a") as a, v1_http(f"{base}/mcp/", "client-b") as b:
            await a.call_tool("add", {"a": 1, "b": 1})
            await b.call_tool("add", {"a": 2, "b": 2})
            await a.list_tools()
    events = flush_and_get(ingest, 5)
    by_client: dict[str, set[str]] = {}
    for event in events:
        by_client.setdefault(event["client"]["name"], set()).add(event["session_id"])
    assert set(by_client) == {"client-a", "client-b"}
    assert all(len(sessions) == 1 for sessions in by_client.values())
    assert by_client["client-a"] != by_client["client-b"]
    assert "mcp" not in by_client and "mcp-use" not in by_client


async def test_gateway_forwarded_requests_are_skipped(ingest: Any) -> None:
    server = instrument(build_server(), ingest)
    with serve_http(http_app(server)) as base:
        async with v1_http(f"{base}/mcp/", "via-gateway", {"X-Gateway-Request-Id": "req_1"}) as driver:
            await driver.call_tool("add", {"a": 1, "b": 2})
        async with v1_http(f"{base}/mcp/", "direct") as driver:
            await driver.call_tool("add", {"a": 1, "b": 2})
    events = flush_and_get(ingest, 2)
    assert {e["client"]["name"] for e in events} == {"direct"}


async def test_payloads_follow_the_dashboard_setting(capture_ingest: Any) -> None:
    server = instrument(build_server(), capture_ingest)
    with serve_http(http_app(server)) as base:
        async with v1_http(f"{base}/mcp/", "client-a") as driver:
            await driver.list_tools()
            await driver.call_tool("echo", {"password": "hunter2", "text": "visible"})
    events = flush_and_get(capture_ingest, 4)
    assert_payloads(events)


async def test_dashboard_change_reaches_the_next_batch(ingest: Any, config_clock: Any) -> None:
    server = instrument(build_server(), ingest)
    with serve_http(http_app(server)) as base:
        async with v1_http(f"{base}/mcp/", "client-a", {"Authorization": f"Bearer {NAMED_JWT}"}) as driver:
            await assert_dashboard_change_reaches_the_next_batch(ingest, config_clock, driver)


async def test_payloads_never_sent_when_disabled_locally(capture_ingest: Any) -> None:
    server = instrument(build_server(), capture_ingest, capture_payloads=False)
    with serve_http(http_app(server)) as base:
        async with v1_http(f"{base}/mcp/", "client-a") as driver:
            await driver.call_tool("echo", {"password": "hunter2", "text": "visible"})
    events = flush_and_get(capture_ingest, 2)
    assert events and all("request_payload" not in e and "response_payload" not in e for e in events)


async def test_stateless_http(ingest: Any) -> None:
    server = instrument(build_server(), ingest)
    with serve_http(http_app(server, stateless=True)) as base:
        async with v1_http(f"{base}/mcp/", "client-a") as driver:
            seen = await run_scenarios(driver)
    events = flush_and_get(ingest, len(seen))
    # A stateless server forgets the connection after each request: only the
    # initialize row knows the client (the ingest edge falls back to User-Agent).
    assert_events_match(events, seen, client_name=None, transport="streamable-http", stateless=True)
    init = next(e for e in events if e["method"] == "initialize")
    assert init["client"]["name"] == "client-a"


async def test_in_memory_connection_has_a_process_session(ingest: Any) -> None:
    server = instrument(build_server(), ingest)
    async with v1_memory(server, "memory-client") as driver:
        seen = await run_scenarios(driver)
    events = flush_and_get(ingest, len(seen))
    mine = assert_events_match(events, seen, client_name="memory-client", transport="stdio", stateless=None)
    assert all("http" not in e for e in mine)


async def test_sse_transport(ingest: Any) -> None:
    server = instrument(build_server(), ingest)
    with serve_http(sse_app(server)) as base:
        async with v1_sse(f"{base}/sse", "sse-client") as driver:
            seen = await run_scenarios(driver)
    events = flush_and_get(ingest, len(seen))
    assert_events_match(events, seen, client_name="sse-client", transport="sse", stateless=None)


async def test_unknown_method_is_a_jsonrpc_error(ingest: Any) -> None:
    server = instrument(build_server(), ingest)
    async with v1_memory(server, "client-a") as driver:
        with pytest.raises(McpError):
            await driver.session.list_resource_templates()
    events = flush_and_get(ingest, 2)
    templates = next(e for e in events if e["method"] == "resources/templates/list")
    assert templates["outcome"] == "error"
    assert templates["error"] == {"code": -32601, "message": "Method not found"}


async def test_instrument_twice_records_once(ingest: Any) -> None:
    server = instrument(instrument(build_server(), ingest), ingest)
    async with v1_memory(server, "client-a") as driver:
        await driver.call_tool("add", {"a": 1, "b": 2})
    events = flush_and_get(ingest, 2)
    assert_recorded_once(events)


async def test_handlers_registered_after_instrument(ingest: Any) -> None:
    server = instrument(build_server(register=False), ingest)
    register_handlers(server)
    async with v1_memory(server, "client-a") as driver:
        assert (await driver.call_tool("add", {"a": 1, "b": 2})).outcome == "success"
    events = flush_and_get(ingest, 2)
    assert any(e["method"] == "tools/call" and e["target"] == "add" and e["outcome"] == "success" for e in events)


async def test_nested_in_process_server_is_recorded_once(ingest: Any) -> None:
    # An instrumented server called from inside another instrumented server's
    # handler (an in-process proxy) is the same end-user request: only the
    # outer server records it.
    from mcp.shared.memory import create_connected_server_and_client_session

    inner = instrument(build_server(), ingest)
    outer: Server = Server("analytics-test", version="1.0.0")

    @outer.list_tools()
    async def list_tools() -> list[types.Tool]:
        return [types.Tool(name="via_inner", inputSchema={"type": "object"})]

    @outer.call_tool()
    async def proxy(name: str, arguments: dict[str, Any]) -> Any:
        async with create_connected_server_and_client_session(inner) as session:
            return (await session.call_tool("add", {"a": 1, "b": 2})).content

    instrument(outer, ingest)
    async with v1_memory(outer, "client-a") as driver:
        seen = await driver.call_tool("via_inner", {})
        assert seen.outcome == "success", seen.message
    events = [e for e in flush_and_get(ingest, 2) if e["method"] != "tools/list"]  # the client's own refresh
    assert sorted((e["method"], e.get("target")) for e in events) == [("initialize", None), ("tools/call", "via_inner")]
