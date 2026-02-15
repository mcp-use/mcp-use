"""
Integration test for MCP resource subscriptions.

Tests the full subscribe -> update -> notification flow:
1. Client connects and subscribes to a resource
2. Client triggers a resource update (via tool call)
3. Client receives the notifications/resources/updated notification
4. Client reads the updated resource to verify the change

Uses the conformance server which has a subscribable resource and
an update_subscribable_resource tool.
"""

import asyncio
import subprocess
import sys
from pathlib import Path

import pytest
from mcp.types import ResourceUpdatedNotification, ServerNotification

from mcp_use.client import MCPClient

CONFORMANCE_SERVER = Path(__file__).parent.parent.parent / "servers_for_testing" / "conformance_server.py"
SERVER_PORT = 8766
SUBSCRIBE_URI = "test://subscribable"


async def _wait_for_server(host: str, port: int, timeout: float = 10.0) -> None:
    """Poll TCP port until the server is accepting connections."""
    import socket

    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        try:
            sock = socket.create_connection((host, port), timeout=0.5)
            sock.close()
            return
        except OSError:
            await asyncio.sleep(0.2)
    raise TimeoutError(f"Server on {host}:{port} did not start within {timeout}s")


@pytest.fixture(scope="module")
async def subscription_server():
    """Start conformance server for subscription tests."""
    import os

    process = subprocess.Popen(
        [sys.executable, str(CONFORMANCE_SERVER), "--transport", "streamable-http", "--port", str(SERVER_PORT)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={**os.environ, "MCP_USE_ANONYMIZED_TELEMETRY": "false"},
    )

    await _wait_for_server("127.0.0.1", SERVER_PORT)

    yield f"http://127.0.0.1:{SERVER_PORT}"

    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


@pytest.mark.asyncio
async def test_resource_subscription_notification(subscription_server):
    """Client subscribes, server updates resource, client receives notification."""
    notifications = []

    async def handler(message):
        if isinstance(message, ServerNotification):
            notifications.append(message)

    config = {"mcpServers": {"server": {"url": f"{subscription_server}/mcp"}}}
    client = MCPClient(config=config, message_handler=handler)

    try:
        await client.create_all_sessions()
        session = client.get_session("server")

        # Subscribe to the resource via raw MCP session
        raw_session = session.connector.client_session
        await raw_session.subscribe_resource(uri=SUBSCRIBE_URI)

        # Trigger the update via tool call
        await session.call_tool("update_subscribable_resource", {"newValue": "test-updated"})

        # Give the notification time to arrive
        await asyncio.sleep(0.5)

        # Verify we received a resource updated notification
        resource_notifications = [n for n in notifications if isinstance(n.root, ResourceUpdatedNotification)]
        assert len(resource_notifications) >= 1, f"Expected resource updated notification, got: {notifications}"
        assert str(resource_notifications[0].root.params.uri) == SUBSCRIBE_URI

        # Read the resource to verify it changed
        result = await session.read_resource(SUBSCRIBE_URI)
        assert result.contents[0].text == "test-updated"

    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_unsubscribe_stops_notifications(subscription_server):
    """After unsubscribing, client should not receive notifications."""
    notifications = []

    async def handler(message):
        if isinstance(message, ServerNotification):
            notifications.append(message)

    config = {"mcpServers": {"server": {"url": f"{subscription_server}/mcp"}}}
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
        await session.call_tool("update_subscribable_resource", {"newValue": "after-unsub"})
        await asyncio.sleep(0.5)

        # Should NOT receive notification after unsubscribe
        resource_notifications = [n for n in notifications if isinstance(n.root, ResourceUpdatedNotification)]
        assert len(resource_notifications) == 0, f"Should not receive notifications after unsubscribe: {notifications}"

    finally:
        await client.close_all_sessions()
