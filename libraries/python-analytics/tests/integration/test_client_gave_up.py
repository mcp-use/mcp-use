"""Requests whose client gave up before the response are recorded once, without an outcome.

A stateless HTTP client that times out (or disconnects), a stateful session
deleted mid-request, a cancelled request and a stdio client that closes stdin
all leave a request without a response the client waits for. The event keeps the request's fields and has no
``outcome``/``error``/``response_size``; the ingest edge reads that like the
gateway's unresolved requests. A request the server still answers after the
client went away (fastmcp lets the tool finish) is not counted twice.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections.abc import Callable
from importlib import metadata, util
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("mcp")
import anyio  # noqa: E402
import httpx  # noqa: E402
from drivers import MCP_MAJOR  # noqa: E402
from harness import flush_and_get, instrument, serve_http  # noqa: E402
from mock_ingest import API_KEY  # noqa: E402

SLOW_SECONDS = 1.0
MCP_VERSION = tuple(int(part) for part in metadata.version("mcp").split(".")[:2])
HEADERS = {"accept": "application/json, text/event-stream", "content-type": "application/json"}
# Older mcp releases redirect /mcp to /mcp/.
CLIENT = {"headers": HEADERS, "follow_redirects": True}
INITIALIZE = {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {"name": "impatient-client", "version": "1.0.0"},
}
UNANSWERED = {"outcome", "error", "response_size", "response_payload"}


def _official(stateless: bool) -> tuple[Any, Callable[[], Any]]:
    async def slow() -> str:
        await anyio.sleep(SLOW_SECONDS)
        return "finished"

    def fast() -> str:
        return "ok"

    if MCP_MAJOR == 1:
        from mcp.server.fastmcp import FastMCP

        mcp: Any = FastMCP("analytics-test", stateless_http=stateless)
        app: Callable[[], Any] = mcp.streamable_http_app
    else:
        from mcp.server.mcpserver import MCPServer

        mcp = MCPServer("analytics-test")

        def app() -> Any:
            return mcp.streamable_http_app(stateless_http=stateless)

    mcp.tool()(slow)
    mcp.tool()(fast)
    return mcp, app


def _community(stateless: bool) -> tuple[Any, Callable[[], Any]]:
    from fastmcp import FastMCP

    mcp = FastMCP("analytics-test")

    @mcp.tool
    async def slow() -> str:
        await anyio.sleep(SLOW_SECONDS)
        return "finished"

    @mcp.tool
    def fast() -> str:
        return "ok"

    return mcp, lambda: mcp.http_app(path="/mcp", stateless_http=stateless)


BUILDERS = [pytest.param(_official, id=f"mcp{MCP_MAJOR}")]
if util.find_spec("fastmcp") is not None:
    BUILDERS.append(pytest.param(_community, id="fastmcp"))


async def _rpc(
    client: httpx.AsyncClient, request_id: int | None, method: str, params: Any = None, **kwargs: Any
) -> httpx.Response:
    message: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
    if request_id is not None:
        message["id"] = request_id
    if params is not None:
        message["params"] = params
    return await client.post("/mcp", json=message, **kwargs)


def _one_call(events: list[dict[str, Any]], tool: str) -> dict[str, Any]:
    calls = [e for e in events if e["method"] == "tools/call" and e.get("target") == tool]
    assert len(calls) == 1, events  # recorded, and only once
    return calls[0]


@pytest.mark.parametrize("build", BUILDERS)
async def test_stateless_http_client_timeout(ingest: Any, build: Callable[..., Any]) -> None:
    mcp, app = build(stateless=True)
    instrument(mcp, ingest)
    with serve_http(app()) as base:
        async with httpx.AsyncClient(base_url=base, **CLIENT) as client:
            await _rpc(client, 1, "initialize", INITIALIZE)
            await _rpc(client, None, "notifications/initialized")
            await _rpc(client, 2, "tools/call", {"name": "fast", "arguments": {}})
            with pytest.raises(httpx.TimeoutException):
                await _rpc(client, 3, "tools/call", {"name": "slow", "arguments": {}}, timeout=0.3)
        await anyio.sleep(SLOW_SECONDS + 0.5)  # the tool finishes (or is cancelled) on the server
        events = flush_and_get(ingest, 3)
    assert _one_call(events, "fast")["outcome"] == "success"
    slow = _one_call(events, "slow")
    if MCP_VERSION >= (1, 12):
        assert UNANSWERED.isdisjoint(slow), slow
    else:
        # Before mcp 1.12 a stateless transport keeps its streams open after the
        # client left and drops the late response itself: the adapter only sees
        # a successful write.
        assert slow["outcome"] == "success", slow
    assert slow["request_id"] == 3 and slow["stateless"] is True and slow["duration_ms"] >= 0


@pytest.mark.parametrize("give_up", ["delete-session", "cancel-request"])
@pytest.mark.parametrize("build", BUILDERS)
async def test_stateful_session_gives_up_mid_request(ingest: Any, build: Callable[..., Any], give_up: str) -> None:
    mcp, app = build(stateless=False)
    instrument(mcp, ingest)
    with serve_http(app()) as base:
        async with httpx.AsyncClient(base_url=base, timeout=10, **CLIENT) as client:
            response = await _rpc(client, 1, "initialize", INITIALIZE)
            session = {"mcp-session-id": response.headers["mcp-session-id"], "mcp-protocol-version": "2025-06-18"}
            await _rpc(client, None, "notifications/initialized", headers=session)
            await _rpc(client, 2, "tools/call", {"name": "fast", "arguments": {}}, headers=session)

            async def slow_call() -> None:
                await _rpc(client, 3, "tools/call", {"name": "slow", "arguments": {}}, headers=session)

            async with anyio.create_task_group() as tasks:
                tasks.start_soon(slow_call)
                await anyio.sleep(0.3)
                if give_up == "delete-session":
                    await client.delete("/mcp", headers=session)
                else:
                    await _rpc(client, None, "notifications/cancelled", {"requestId": 3}, headers=session)
                await anyio.sleep(0.2)
                tasks.cancel_scope.cancel()
        await anyio.sleep(SLOW_SECONDS + 0.5)
        events = flush_and_get(ingest, 3)
    assert _one_call(events, "fast")["outcome"] == "success"
    slow = _one_call(events, "slow")
    assert UNANSWERED.isdisjoint(slow), slow
    assert slow["session_id"] == session["mcp-session-id"]


SLOW_STDIO_SERVER = """
import anyio
from importlib import metadata

import mcp_use_analytics

if int(metadata.version("mcp").split(".")[0]) == 1:
    from mcp.server.fastmcp import FastMCP as Server
else:
    from mcp.server.mcpserver import MCPServer as Server

mcp = Server("analytics-test")


@mcp.tool()
async def slow() -> str:
    await anyio.sleep(%(seconds)s)
    return "finished"


@mcp.tool()
def fast() -> str:
    return "ok"


mcp_use_analytics.instrument(mcp)
mcp.run()
"""


def test_stdio_client_closes_stdin_mid_request(ingest: Any, tmp_path: Path) -> None:
    # A one-shot client writes its requests and closes stdin without waiting.
    script = tmp_path / "slow_stdio_server.py"
    script.write_text(SLOW_STDIO_SERVER % {"seconds": SLOW_SECONDS})
    messages = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": INITIALIZE},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "fast", "arguments": {}}},
        {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "slow", "arguments": {}}},
    ]
    env = dict(os.environ, MANUFACT_ANALYTICS_KEY=API_KEY, MANUFACT_ANALYTICS_URL=ingest.url)
    stdin = "".join(json.dumps(message) + "\n" for message in messages).encode()
    completed = subprocess.run(
        [sys.executable, str(script)], input=stdin, capture_output=True, env=env, timeout=60, check=False
    )
    replies = [json.loads(line) for line in completed.stdout.decode().splitlines() if line.strip()]
    assert not any(reply.get("id") == 3 and "result" in reply for reply in replies), replies
    assert ingest.wait_for(lambda i: {"fast", "slow"} <= {e.get("target") for e in i.events}, timeout=15), ingest.events
    events = ingest.events
    # The fast call may or may not be answered before the server sees EOF; either way it is recorded once.
    fast = _one_call(events, "fast")
    assert fast.get("outcome") == ("success" if any(reply.get("id") == 2 for reply in replies) else None), fast
    slow = _one_call(events, "slow")
    assert UNANSWERED.isdisjoint(slow), slow
    assert slow["transport"] == "stdio" and slow["client"]["name"] == "impatient-client"
