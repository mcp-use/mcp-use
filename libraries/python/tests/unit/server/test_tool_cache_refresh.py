"""Regression coverage for a tool call before tools/list."""

import pytest
from mcp.types import CallToolRequest, CallToolRequestParams

from mcp_use.server import MCPServer
from mcp_use.server.middleware import Middleware


@pytest.mark.asyncio
async def test_first_tool_call_refreshes_cache_through_middleware():
    list_messages = []

    class TrackListTools(Middleware):
        async def on_list_tools(self, context, call_next):
            list_messages.append(context.message)
            return await call_next(context)

    server = MCPServer(name="cache-refresh-test", middleware=[TrackListTools()])

    @server.tool()
    async def greet(name: str) -> str:
        return f"Hello, {name}!"

    server._wrap_handlers_with_middleware()
    request = CallToolRequest(
        method="tools/call",
        params=CallToolRequestParams(name="greet", arguments={"name": "Alice"}),
    )

    result = await server._mcp_server.request_handlers[CallToolRequest](request)

    assert result.root.isError is not True
    assert result.root.content[0].text == "Hello, Alice!"
    assert list_messages == [None]
