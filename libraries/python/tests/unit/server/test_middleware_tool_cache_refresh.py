"""Regression tests for MCP SDK's internal tool-cache refresh requests."""

import pytest
from mcp.types import CallToolRequest, CallToolRequestParams

from mcp_use import MCPServer
from mcp_use.server.middleware import Middleware


class ListToolsTrackingMiddleware(Middleware):
    def __init__(self) -> None:
        self.messages = []

    async def on_list_tools(self, context, call_next):
        self.messages.append(context.message)
        return await call_next(context)


@pytest.mark.asyncio
async def test_tool_call_refreshes_tool_cache_with_none_list_request() -> None:
    middleware = ListToolsTrackingMiddleware()
    server = MCPServer(name="test-server", middleware=[middleware])

    @server.tool()
    async def hello_tool(name: str) -> str:
        return f"Hello, {name}!"

    server._wrap_handlers_with_middleware()
    call_handler = server._mcp_server.request_handlers[CallToolRequest]
    request = CallToolRequest(
        method="tools/call",
        params=CallToolRequestParams(name="hello_tool", arguments={"name": "Alice"}),
    )

    result = await call_handler(request)

    assert result.root.isError is not True
    assert result.root.content[0].text == "Hello, Alice!"
    assert middleware.messages == [None]
