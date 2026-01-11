import pytest
from mcp.client.session import RequestContext
from mcp.types import ElicitRequestParams, ElicitResult

from mcp_use.client import MCPClient


async def elicitation_callback(ctx: RequestContext, params: ElicitRequestParams) -> ElicitResult:
    """Elicit the user to summarize text."""
    return ElicitResult(
        action="accept",
        content={"quantity": 1, "unit": "kg"},
    )


@pytest.mark.asyncio
async def test_elicitation(primitive_server):
    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config, elicitation_callback=elicitation_callback)  # type: ignore[invalid-argument-type]
    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")
        result = await session.call_tool(name="purchase_item", arguments={})
        assert result.content[0].text == "You are buying 1 kg of the item"
    finally:
        await client.close_all_sessions()
