import pytest

from mcp_use.client import MCPClient


async def handle_logging(message):
    print(f"Received logging message: {message}")


@pytest.mark.asyncio
async def test_tool(primitive_server):
    """Tests the 'add' tool on the primitive server."""
    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config, logging_callback=handle_logging)
    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")

        result = await session.call_tool(name="long_running_task", arguments={"task_name": "test", "steps": 5})
        assert result.content[0].text == "Task 'test' completed"
    finally:
        await client.close_all_sessions()
