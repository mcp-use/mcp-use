import asyncio
import subprocess
from pathlib import Path

import pytest

from mcp_use import MCPClient


@pytest.fixture
async def server_process():
    """Start the SSE server process for testing"""
    server_path = Path(__file__).parent.parent.parent / "servers_for_testing" / "simple_server.py"

    print(f"Starting server: python {server_path}")

    # Start the server process
    process = subprocess.Popen(
        ["python", str(server_path), "--transport", "sse"],
        cwd=str(server_path.parent),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    # Give the server a moment to start
    await asyncio.sleep(1)
    server_url = "http://127.0.0.1:8000"
    yield server_url

    # Cleanup
    print("Cleaning up server process")
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


@pytest.mark.asyncio
async def test_sse_connection(server_process):
    """Test that we can connect to SSE MCP server and retrieve tools"""
    server_url = server_process
    config = {"mcpServers": {"sse": {"url": f"{server_url}/sse"}}}

    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("sse")

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
