from pathlib import Path

import pytest

from mcp_use import MCPClient


@pytest.fixture
def server_process():
    """Start the stdio server process for testing"""
    server_path = Path(__file__).parent.parent.parent / "servers_for_testing" / "simple_server.py"
    # Start server process - stdio doesn't need a separate process since it's spawned by the client
    yield server_path


@pytest.mark.asyncio
async def test_stdio_connection(server_process):
    """Test that we can connect to stdio MCP server and retrieve tools"""
    server_path = server_process
    config = {
        "mcpServers": {
            "stdio": {
                "command": "python",
                "args": [str(server_path)],
                "cwd": str(server_path.parent),
            }
        }
    }

    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("stdio")

        # Verify session was created
        assert session is not None, "Session should be created"

        # Get tools and verify they exist
        tools = session.connector.tools
        assert tools is not None, "Tools should be available"
        assert len(tools) > 0, "At least one tool should be available"

        # Verify the 'add' tool exists
        tool_names = [tool.name for tool in tools]
        assert "add" in tool_names, "The 'add' tool should be available"

        # Test calling the add tool
        result = await session.connector.call_tool("add", {"a": 5, "b": 3})
        assert result is not None, "Tool call should return a result"
        assert result.content is not None, "Result should have content"
        assert result.content[0].text == "8", "Result should be 8"
    finally:
        await client.close_all_sessions()
