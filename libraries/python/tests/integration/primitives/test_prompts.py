import pytest

from mcp_use.client import MCPClient


@pytest.mark.asyncio
async def test_summarize_text_prompt(primitive_server):
    """Tests the 'summarize_text' prompt primitive."""
    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config)
    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")
        prompt = await session.get_prompt(
            name="summarize_text", arguments={"text": "This is a long text to summarize."}
        )
        message = prompt.messages[0]
        assert "Please summarize the following text: This is a long text to summarize." in message.content.text
    finally:
        await client.close_all_sessions()
