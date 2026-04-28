"""
Unit tests for the WebSocketConnector class.
"""

from unittest.mock import AsyncMock, patch

import pytest

from mcp_use.client.connectors.websocket import WebSocketConnector


@pytest.fixture(autouse=True)
def mock_logger():
    """Mock the logger to prevent errors during tests."""
    with (
        patch("mcp_use.client.connectors.base.logger"),
        patch("mcp_use.client.connectors.websocket.logger"),
    ):
        yield


class TestWebSocketConnectorDisconnect:
    """Tests for WebSocketConnector.disconnect()."""

    @pytest.mark.asyncio
    async def test_disconnect(self):
        """Test disconnecting from MCP implementation."""
        connector = WebSocketConnector("ws://localhost:8080")
        connector._connected = True
        connector._cleanup_resources = AsyncMock()

        await connector.disconnect()

        connector._cleanup_resources.assert_called_once()
        assert connector._connected is False

    @pytest.mark.asyncio
    async def test_disconnect_not_connected(self):
        """Test disconnect is a no-op when not connected."""
        connector = WebSocketConnector("ws://localhost:8080")
        connector._connected = False
        connector._cleanup_resources = AsyncMock()

        await connector.disconnect()

        connector._cleanup_resources.assert_not_called()
        assert connector._connected is False

    @pytest.mark.asyncio
    async def test_disconnect_called_twice_runs_cleanup_once(self):
        """Calling disconnect twice in a row must clean up resources only once."""
        connector = WebSocketConnector("ws://localhost:8080")
        connector._connected = True
        connector._cleanup_resources = AsyncMock()

        await connector.disconnect()
        await connector.disconnect()

        connector._cleanup_resources.assert_called_once()
        assert connector._connected is False

    @pytest.mark.asyncio
    async def test_disconnect_reentrant_call_skips_second_cleanup(self):
        """A re-entrant disconnect during ``_cleanup_resources`` must not run cleanup twice.

        Mirrors the regression test added in PR #1412 for ``BaseConnector``: while
        the first ``disconnect`` is awaiting ``_cleanup_resources``, an
        ``AsyncExitStack`` teardown (or another caller) invokes ``disconnect``
        again. The guard at the top of ``disconnect`` must already see
        ``_connected == False`` so the second call returns early instead of
        re-running cleanup against an already-closed WebSocket transport.
        """
        connector = WebSocketConnector("ws://localhost:8080")
        connector._connected = True

        cleanup_call_count = 0

        async def reentrant_cleanup():
            nonlocal cleanup_call_count
            cleanup_call_count += 1
            # Simulate a concurrent/re-entrant disconnect firing while we
            # are still inside the first call's cleanup await.
            await connector.disconnect()

        connector._cleanup_resources = reentrant_cleanup

        await connector.disconnect()

        assert cleanup_call_count == 1
        assert connector._connected is False
