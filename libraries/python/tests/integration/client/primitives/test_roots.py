"""Integration tests for the roots capability.

These tests verify that the client properly exposes roots to MCP servers
and that servers can request the list of roots from the client.
"""

import json
import logging

import pytest
from mcp.types import ListRootsResult, Root

from mcp_use.client import MCPClient

logger = logging.getLogger(__name__)


@pytest.mark.asyncio
async def test_roots_capability(primitive_server):
    """Test that a server can request and receive roots from the client."""
    # Define roots to expose to the server
    roots = [
        Root(uri="file:///home/user/project", name="My Project"),
        Root(uri="file:///home/user/data"),
    ]

    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config, roots=roots)

    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")

        # Call the get_client_roots tool which requests roots from the client
        result = await session.call_tool(name="get_client_roots", arguments={})
        content = result.content[0]
        logger.info(f"Result: {content}")

        # Parse the JSON response
        data = json.loads(content.text)

        # Verify the roots were received correctly
        assert data["count"] == 2
        assert len(data["roots"]) == 2

        # Check first root (with name)
        root1 = data["roots"][0]
        assert root1["uri"] == "file:///home/user/project"
        assert root1["name"] == "My Project"

        # Check second root (without name)
        root2 = data["roots"][1]
        assert root2["uri"] == "file:///home/user/data"
        assert root2["name"] is None

    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_roots_empty_by_default(primitive_server):
    """Test that roots are empty when not provided."""
    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config)

    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")

        # Call the get_client_roots tool
        result = await session.call_tool(name="get_client_roots", arguments={})
        content = result.content[0]
        logger.info(f"Result: {content}")

        # Parse the JSON response
        data = json.loads(content.text)

        # Verify no roots were returned
        assert data["count"] == 0
        assert len(data["roots"]) == 0

    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_roots_with_custom_callback(primitive_server):
    """Test that a custom list_roots_callback can provide dynamic roots."""
    # Custom callback that returns different roots
    custom_roots = [
        Root(uri="file:///custom/workspace", name="Custom Workspace"),
    ]

    async def custom_list_roots_callback(context):
        return ListRootsResult(roots=custom_roots)

    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(
        config,
        roots=[Root(uri="file:///default/path")],  # Default roots (should be ignored)
        list_roots_callback=custom_list_roots_callback,
    )

    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")

        # Call the get_client_roots tool
        result = await session.call_tool(name="get_client_roots", arguments={})
        content = result.content[0]
        logger.info(f"Result: {content}")

        # Parse the JSON response
        data = json.loads(content.text)

        # Verify custom callback's roots were returned, not default
        assert data["count"] == 1
        assert data["roots"][0]["uri"] == "file:///custom/workspace"
        assert data["roots"][0]["name"] == "Custom Workspace"

    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_set_roots_updates_server_view(primitive_server):
    """Test that set_roots() updates the roots visible to the server."""
    # Start with initial roots
    initial_roots = [
        Root(uri="file:///initial/path", name="Initial"),
    ]

    config = {"mcpServers": {"PrimitiveServer": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config, roots=initial_roots)

    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")

        # Verify initial roots
        result = await session.call_tool(name="get_client_roots", arguments={})
        data = json.loads(result.content[0].text)
        assert data["count"] == 1
        assert data["roots"][0]["uri"] == "file:///initial/path"

        # Update roots via connector
        new_roots = [
            Root(uri="file:///updated/path1", name="Updated 1"),
            Root(uri="file:///updated/path2", name="Updated 2"),
        ]
        await session.connector.set_roots(new_roots)

        # Verify updated roots
        result = await session.call_tool(name="get_client_roots", arguments={})
        data = json.loads(result.content[0].text)
        assert data["count"] == 2
        assert data["roots"][0]["uri"] == "file:///updated/path1"
        assert data["roots"][1]["uri"] == "file:///updated/path2"

    finally:
        await client.close_all_sessions()
