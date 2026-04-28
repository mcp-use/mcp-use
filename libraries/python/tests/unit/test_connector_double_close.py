"""
Unit tests for the double-close guard in BaseConnector.disconnect().

Regression test for https://github.com/mcp-use/mcp-use/issues/1220
"""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from mcp_use.client.connectors.stdio import StdioConnector


@pytest.fixture(autouse=True)
def mock_logger():
    """Mock the logger to prevent errors during tests."""
    with patch("mcp_use.client.connectors.base.logger"):
        yield


class TestDoubleCloseGuard:
    """Verify that disconnect() only cleans up resources once, even when called concurrently."""

    @pytest.mark.asyncio
    async def test_sequential_disconnect_calls_cleanup_once(self):
        """Calling disconnect() twice sequentially should only clean up once."""
        connector = StdioConnector()
        connector._connected = True
        connector._cleanup_resources = AsyncMock()

        await connector.disconnect()
        await connector.disconnect()

        connector._cleanup_resources.assert_called_once()

    @pytest.mark.asyncio
    async def test_concurrent_disconnect_calls_cleanup_once(self):
        """Two concurrent disconnect() calls should only clean up once."""
        connector = StdioConnector()
        connector._connected = True

        cleanup_call_count = 0

        async def slow_cleanup():
            nonlocal cleanup_call_count
            cleanup_call_count += 1
            await asyncio.sleep(0.05)

        connector._cleanup_resources = slow_cleanup

        await asyncio.gather(connector.disconnect(), connector.disconnect())

        assert cleanup_call_count == 1

    @pytest.mark.asyncio
    async def test_concurrent_disconnect_waits_for_cleanup(self):
        """A concurrent disconnect() caller must block until cleanup finishes."""
        connector = StdioConnector()
        connector._connected = True

        cleanup_done = False

        async def slow_cleanup():
            nonlocal cleanup_done
            await asyncio.sleep(0.05)
            cleanup_done = True

        connector._cleanup_resources = slow_cleanup

        # Both calls should complete, and by the time they return cleanup must be done
        await asyncio.gather(connector.disconnect(), connector.disconnect())

        assert cleanup_done is True

    @pytest.mark.asyncio
    async def test_disconnect_when_not_connected_is_noop(self):
        """disconnect() on a not-connected connector should not call cleanup."""
        connector = StdioConnector()
        connector._connected = False
        connector._cleanup_resources = AsyncMock()

        await connector.disconnect()

        connector._cleanup_resources.assert_not_called()
