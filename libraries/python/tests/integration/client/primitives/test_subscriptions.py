"""
Integration test for MCP resource subscriptions.

Tests the full subscribe -> update -> notification flow:
1. Client connects and subscribes to a resource
2. Client triggers a resource update (via tool call)
3. Client receives the notifications/resources/updated notification
4. Client reads the updated resource to verify the change

Uses the primitive server's data://live resource and set_live_data tool.
"""

import asyncio

import pytest
from mcp.types import ResourceUpdatedNotification, ServerNotification

from mcp_use.client import MCPClient

SUBSCRIBE_URI = "data://live"


@pytest.mark.asyncio
async def test_resource_subscription_notification(primitive_server):
    """Client subscribes, server updates resource, client receives notification."""
    notifications = []

    async def handler(message):
        if isinstance(message, ServerNotification):
            notifications.append(message)

    config = {"mcpServers": {"server": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config=config, message_handler=handler)

    try:
        await client.create_all_sessions()
        session = client.get_session("server")

        # Subscribe to the resource
        raw_session = session.connector.client_session
        await raw_session.subscribe_resource(uri=SUBSCRIBE_URI)

        # Trigger the update via tool call
        await session.call_tool("set_live_data", {"value": "updated-value"})

        # Give the notification time to arrive
        await asyncio.sleep(0.5)

        # Verify we received a resource updated notification
        resource_notifications = [n for n in notifications if isinstance(n.root, ResourceUpdatedNotification)]
        assert len(resource_notifications) >= 1, f"Expected resource updated notification, got: {notifications}"
        assert str(resource_notifications[0].root.params.uri) == SUBSCRIBE_URI

        # Read the resource to verify it changed
        result = await session.read_resource(SUBSCRIBE_URI)
        assert result.contents[0].text == "updated-value"

    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_unsubscribe_stops_notifications(primitive_server):
    """After unsubscribing, client should not receive notifications."""
    notifications = []

    async def handler(message):
        if isinstance(message, ServerNotification):
            notifications.append(message)

    config = {"mcpServers": {"server": {"url": f"{primitive_server}/mcp"}}}
    client = MCPClient(config=config, message_handler=handler)

    try:
        await client.create_all_sessions()
        session = client.get_session("server")

        raw_session = session.connector.client_session

        # Subscribe then unsubscribe
        await raw_session.subscribe_resource(uri=SUBSCRIBE_URI)
        await raw_session.unsubscribe_resource(uri=SUBSCRIBE_URI)

        # Clear any notifications from subscribe phase
        notifications.clear()

        # Trigger update
        await session.call_tool("set_live_data", {"value": "after-unsub"})
        await asyncio.sleep(0.5)

        # Should NOT receive notification after unsubscribe
        resource_notifications = [n for n in notifications if isinstance(n.root, ResourceUpdatedNotification)]
        assert len(resource_notifications) == 0, f"Got notifications after unsubscribe: {resource_notifications}"

    finally:
        await client.close_all_sessions()
