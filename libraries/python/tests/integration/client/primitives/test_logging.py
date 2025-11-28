import pytest
from mcp.types import LoggingMessageNotificationParams

from mcp_use.client import MCPClient


async def handle_logging(log_params: LoggingMessageNotificationParams) -> None:
    print(f"LOG [{log_params.level.upper()}]: {log_params.message}")  # type: ignore[unresolved-attribute]


@pytest.mark.asyncio
async def test_tool(primitive_server):
    """Tests the 'add' tool on the primitive server."""
    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config, logging_callback=handle_logging)  # type: ignore[invalid-argument-type]
    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")
        result = await session.call_tool(name="logging_tool", arguments={})
        assert result.content[0].text == "Logging tool completed"
    finally:
        await client.close_all_sessions()
