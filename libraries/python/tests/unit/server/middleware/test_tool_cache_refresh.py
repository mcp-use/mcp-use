"""
Regression tests for tool calls made before any tools/list on a fresh server.

The MCP SDK's ``Server._get_cached_tool_definition`` refreshes its tool cache
by invoking the registered ``ListToolsRequest`` handler with ``request=None``.
The middleware wrapper in ``MCPServer._wrap_handlers_with_middleware`` must
tolerate that internal invocation (previously it crashed with
``AttributeError: 'NoneType' object has no attribute 'params'`` and the tool
call failed).
"""

import pytest
from mcp import types

from mcp_use import MCPServer
from mcp_use.server.middleware import Middleware


@pytest.mark.asyncio
async def test_tool_call_before_tools_list_succeeds():
    """tools/call on a fresh server must not fail when the SDK refreshes its
    internal tool cache (which passes request=None to the list handler)."""
    mcp = MCPServer(name="test-server")

    @mcp.tool()
    async def hello_tool(name: str) -> str:
        return f"Hello, {name}!"

    mcp._wrap_handlers_with_middleware()

    req = types.CallToolRequest(
        method="tools/call",
        params=types.CallToolRequestParams(name="hello_tool", arguments={"name": "Alice"}),
    )
    call_handler = mcp._mcp_server.request_handlers[types.CallToolRequest]
    res = await call_handler(req)

    result = res.root if hasattr(res, "root") else res
    assert result.isError is False
    assert result.content[0].text == "Hello, Alice!"


@pytest.mark.asyncio
async def test_list_handler_called_with_none_passes_none_message_to_middleware():
    """The internal cache-refresh invocation (request=None) should reach
    middleware with message=None and still return the tool list."""
    seen_messages = []

    class RecordingMiddleware(Middleware):
        async def on_list_tools(self, context, call_next):
            seen_messages.append(context.message)
            return await call_next(context)

    mcp = MCPServer(name="test-server", middleware=[RecordingMiddleware()])

    @mcp.tool()
    async def hello_tool(name: str) -> str:
        return f"Hello, {name}!"

    mcp._wrap_handlers_with_middleware()

    list_handler = mcp._mcp_server.request_handlers[types.ListToolsRequest]
    res = await list_handler(None)

    result = res.root if hasattr(res, "root") else res
    tool_names = {tool.name for tool in result.tools}
    assert "hello_tool" in tool_names
    assert seen_messages == [None]
