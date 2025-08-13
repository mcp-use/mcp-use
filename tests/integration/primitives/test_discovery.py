import asyncio

import pytest

from mcp_use.client import MCPClient


@pytest.mark.asyncio
async def test_tool_list_update(primitive_server):
    """Tests that the tool list is automatically updated after a change notification."""
    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config)
    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")
        # Initial state: Check that all tools are present
        tools = await session.list_tools()
        assert "tool_to_disable" in [tool.name for tool in tools]

        # Trigger the change (this will disable the tool and send a notification)
        await session.call_tool(name="change_tools", arguments={})

        # The tool list should be refreshed automatically on next call
        tools = await session.list_tools()
        assert "tool_to_disable" not in [tool.name for tool in tools]
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_resource_list_update(primitive_server):
    """Tests that the resource list is automatically updated after a change notification."""
    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config)
    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")
        # Initial state: Check that we have at least one resource
        resources = await session.list_resources()
        assert "resource_to_disable" in [resource.name for resource in resources]

        # Trigger the change (this will disable a resource and send a notification)
        await session.call_tool(name="change_resources", arguments={})

        # The resource list should be refreshed automatically on next call
        resources = await session.list_resources()
        assert "resource_to_disable" not in [resource.name for resource in resources]
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_prompt_list_update(primitive_server):
    """Tests that the prompt list is automatically updated after a change notification."""
    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config)
    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")
        # Initial state: Check that all prompts are present
        prompts = await session.list_prompts()
        assert "prompt_to_disable" in [prompt.name for prompt in prompts]

        # Trigger the change (this will disable the prompt and send a notification)
        await session.call_tool(name="change_prompts", arguments={})
        # The prompt list should be refreshed automatically on next call
        prompts = await session.list_prompts()
        assert "prompt_to_disable" not in [prompt.name for prompt in prompts]
    finally:
        await client.close_all_sessions()
