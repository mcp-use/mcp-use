import asyncio
import subprocess
from pathlib import Path

import pytest

from mcp_use import MCPClient


@pytest.fixture
async def server_process():
    """Start the streamableHttp server process for testing"""
    server_path = Path(__file__).parent.parent.parent / "servers_for_testing" / "simple_server.py"

    print(f"Starting server: python {server_path}")

    # Start the server process
    process = subprocess.Popen(
        ["python", str(server_path), "--transport", "streamable-http"],
        cwd=str(server_path.parent),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    # Wait for server to start up
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
            print("Process didn't terminate gracefully, killing it")
            process.kill()
            process.wait()

    print("Server cleanup complete")


@pytest.mark.asyncio
async def test_streamable_http_connection(server_process):
    """Test that we can connect to streamableHttp MCP server and retrieve tools"""
    server_url = server_process
    config = {"mcpServers": {"streamableHttp": {"url": f"{server_url}/mcp"}}}
    print(config)
    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("streamableHttp")

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
