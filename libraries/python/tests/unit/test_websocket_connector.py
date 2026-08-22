"""Unit tests for WebSocketConnector."""

import pytest

from mcp_use.client.connectors.websocket import WebSocketConnector


class TestWebSocketConnectorDisconnect:
    """Tests for WebSocketConnector.disconnect()."""

    @pytest.mark.asyncio
    async def test_disconnect_reentrant_call_skips_second_cleanup(self):
        """Re-entrant disconnect during cleanup should not run cleanup twice."""
        connector = WebSocketConnector("ws://localhost:8080")
        connector._connected = True
        cleanup_call_count = 0

        async def reentrant_cleanup() -> None:
            nonlocal cleanup_call_count
            cleanup_call_count += 1
            await connector.disconnect()

        connector._cleanup_resources = reentrant_cleanup

        await connector.disconnect()

        assert cleanup_call_count == 1
        assert connector._connected is False
