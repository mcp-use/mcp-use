import pytest
from mcp.client.session import ClientSession
from mcp.types import (
    CreateMessageRequestParams,
    CreateMessageResult,
    ErrorData,
    TextContent,
)

from mcp_use.client import MCPClient


@pytest.mark.asyncio
async def test_tool(primitive_server):
    """Tests the 'add' tool on the primitive server."""
    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config)
    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")

        result = await session.connector.call_tool(name="add", arguments={"a": 5, "b": 3})
        assert result.content[0].text == "8"

        result = await session.connector.call_tool(name="add", arguments={"a": -1, "b": 1})
        assert result.content[0].text == "0"
    finally:
        await client.close_all_sessions()
