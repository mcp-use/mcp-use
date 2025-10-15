import json

import pytest

from mcp_use.client import MCPClient


@pytest.mark.asyncio
async def test_static_resource(primitive_server):
    """Tests fetching a static resource."""
    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config)
    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")
        result = await session.read_resource(uri="data://config")
        resource = result.contents[0].text
        resource_dict = json.loads(resource)
        assert resource_dict == {"version": "1.0", "status": "ok"}
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_templated_resource(primitive_server):
    """Tests fetching a templated resource."""
    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config)
    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")
        result = await session.read_resource(uri="users://123/profile")
        resource = result.contents[0].text
        resource_dict = json.loads(resource)
        assert resource_dict == {"id": 123, "name": "User 123"}

        result = await session.read_resource(uri="users://456/profile")
        resource = result.contents[0].text
        resource_dict = json.loads(resource)
        assert resource_dict == {"id": 456, "name": "User 456"}
    finally:
        await client.close_all_sessions()
