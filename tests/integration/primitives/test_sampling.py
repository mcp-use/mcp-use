import asyncio
import logging

import pytest
from mcp.client.session import ClientSession
from mcp.types import CreateMessageRequestParams, CreateMessageResult, ErrorData, TextContent

from mcp_use.client import MCPClient

logger = logging.getLogger(__name__)


async def sampling_callback(
    context: ClientSession, params: CreateMessageRequestParams
) -> CreateMessageResult | ErrorData:
    return CreateMessageResult(
        content=TextContent(text="Hello, world!", type="text"), model="gpt-4o-mini", role="assistant"
    )


@pytest.mark.asyncio
async def test_sampling(primitive_server):
    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config, sampling_callback=sampling_callback)
    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")
        result = await session.connector.call_tool(name="analyze_sentiment", arguments={"text": "Hello, world!"})
        content = result.content[0]
        logger.info(f"Result: {content}")
        assert content.text == "Hello, world!"
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_sampling_with_no_callback(primitive_server):
    try:
        config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
        client = MCPClient(config)
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")
        result = await session.connector.call_tool(name="analyze_sentiment", arguments={"text": "Hello, world!"})
        logger.info(f"Result: {result}")
        print(f"Result: {result}")
        assert result.isError
    finally:
        await client.close_all_sessions()
