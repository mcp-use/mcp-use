"""A real stdio subprocess (official ``FastMCP`` on mcp 1.x, ``MCPServer`` on 2.x).

Covers configuration from the environment and delivery by the exit-time flush.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("mcp")
from importlib import metadata  # noqa: E402

from drivers import MCP_MAJOR, V1Driver, V2Driver, _implementation  # noqa: E402
from harness import Seen  # noqa: E402
from mock_ingest import API_KEY  # noqa: E402

SERVER = Path(__file__).with_name("stdio_server.py")
_MCP_VERSION = tuple(int(part) for part in metadata.version("mcp").split(".")[:2])


# Before mcp 1.13 the stdio client SIGTERMs the server as soon as it exits,
# without closing stdin first, so no exit-time flush can run (see README).
@pytest.mark.skipif(_MCP_VERSION < (1, 13), reason="client kills the server without a graceful shutdown")
async def test_stdio_server_flushes_at_exit(ingest: Any) -> None:
    from mcp import StdioServerParameters

    params = StdioServerParameters(
        command=sys.executable,
        args=[str(SERVER)],
        env={"MANUFACT_ANALYTICS_KEY": API_KEY, "MANUFACT_ANALYTICS_URL": ingest.url},
    )
    if MCP_MAJOR == 1:
        from mcp import ClientSession
        from mcp.client.stdio import stdio_client

        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write, client_info=_implementation("stdio-client")) as session:
                await session.initialize()
                assert await V1Driver(session).call_tool("add", {"a": 1, "b": 2}) == Seen("tools/call", "add")
    else:
        from mcp import Client

        async with Client(params, client_info=_implementation("stdio-client"), mode="legacy", cache=None) as client:
            assert await V2Driver(client).call_tool("add", {"a": 1, "b": 2}) == Seen("tools/call", "add")

    assert ingest.wait_for(lambda i: {"initialize", "tools/call"} <= {e["method"] for e in i.events}, timeout=15)
    events = ingest.events
    assert {e["transport"] for e in events} == {"stdio"}
    assert len({e["session_id"] for e in events}) == 1
    call = next(e for e in events if e["method"] == "tools/call")
    assert call["client"]["name"] == "stdio-client" and call["outcome"] == "success"
    assert ingest.batches[0]["sdk"]["framework"] == f"mcp-sdk-v{MCP_MAJOR}"
