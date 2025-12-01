#!/usr/bin/env python3
"""Unit tests for WebSocketConnectionManager."""

from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

from mcp_use.client.task_managers.websocket import WebSocketConnectionManager


class TestWebSocketConnectionManager:
    """Test cases for WebSocketConnectionManager."""

    def test_init_with_url_only(self):
        """Test that WebSocketConnectionManager can be initialized with URL only."""
        url = "ws://localhost:8080"
        manager = WebSocketConnectionManager(url)

        assert manager.url == url
        assert manager.headers == {}

    def test_init_with_url_and_headers(self):
        """Test that WebSocketConnectionManager can be initialized with URL and headers."""
        url = "ws://localhost:8080"
        headers = {"Authorization": "Bearer token123", "User-Agent": "test-client"}
        manager = WebSocketConnectionManager(url, headers)

        assert manager.url == url
        assert manager.headers == headers

    def test_init_with_url_and_none_headers(self):
        """Test that WebSocketConnectionManager handles None headers correctly."""
        url = "ws://localhost:8080"
        manager = WebSocketConnectionManager(url, None)

        assert manager.url == url
        assert manager.headers == {}

    def test_init_with_empty_headers(self):
        """Test that WebSocketConnectionManager handles empty headers correctly."""
        url = "ws://localhost:8080"
        headers = {}
        manager = WebSocketConnectionManager(url, headers)

        assert manager.url == url
        assert manager.headers == headers

    def test_headers_parameter_optional(self):
        """Test that headers parameter is optional and defaults correctly."""
        url = "ws://localhost:8080"

        # Should work without headers parameter
        manager1 = WebSocketConnectionManager(url)
        assert manager1.headers == {}

        # Should work with explicit None
        manager2 = WebSocketConnectionManager(url, None)
        assert manager2.headers == {}

        # Should work with actual headers
        headers = {"Content-Type": "application/json"}
        manager3 = WebSocketConnectionManager(url, headers)
        assert manager3.headers == headers

    def test_fix_for_issue_118(self):
        """Test that reproduces and verifies the fix for GitHub issue #118.

        The original error was:
        WebSocketConnectionManager.__init__() takes 2 positional arguments but 3 were given

        This happened because WebSocketConnector was trying to pass headers to
        WebSocketConnectionManager, but the constructor didn't accept headers.
        """
        url = "ws://example.com"
        headers = {"Authorization": "Bearer test-token"}

        # This should NOT raise "takes 2 positional arguments but 3 were given"
        try:
            manager = WebSocketConnectionManager(url, headers)
            assert manager.url == url
            assert manager.headers == headers
        except TypeError as e:
            pytest.fail(f"WebSocketConnectionManager failed to accept headers parameter: {e}")


class TestWebSocketConnectionManagerConnection:
    """Tests for connection establishment and closure."""

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.websocket.websocket_client")
    @patch("mcp_use.client.task_managers.websocket.logger")
    async def test_establish_connection_success(self, mock_logger, mock_websocket_client):
        """Test successful connection establishment."""
        url = "ws://localhost:8080"
        manager = WebSocketConnectionManager(url)

        # Mock the context manager
        mock_ctx = MagicMock()
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(mock_read_stream, mock_write_stream))
        mock_websocket_client.return_value = mock_ctx

        connection = await manager._establish_connection()

        assert connection == (mock_read_stream, mock_write_stream)
        assert manager._ws_ctx == mock_ctx
        mock_websocket_client.assert_called_once_with(url)
        mock_ctx.__aenter__.assert_called_once()
        mock_logger.debug.assert_called()

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.websocket.websocket_client")
    async def test_establish_connection_failure(self, mock_websocket_client):
        """Test connection establishment failure."""
        url = "ws://localhost:8080"
        manager = WebSocketConnectionManager(url)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(side_effect=ConnectionError("Connection failed"))
        mock_websocket_client.return_value = mock_ctx

        with pytest.raises(ConnectionError, match="Connection failed"):
            await manager._establish_connection()

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.websocket.websocket_client")
    @patch("mcp_use.client.task_managers.websocket.logger")
    async def test_close_connection_success(self, mock_logger, mock_websocket_client):
        """Test successful connection closure."""
        url = "ws://localhost:8080"
        manager = WebSocketConnectionManager(url)

        # Establish connection first
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_ctx.__aexit__ = AsyncMock()
        mock_websocket_client.return_value = mock_ctx

        await manager._establish_connection()
        await manager._close_connection()

        mock_ctx.__aexit__.assert_called_once_with(None, None, None)
        assert manager._ws_ctx is None
        mock_logger.debug.assert_called()

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.websocket.websocket_client")
    @patch("mcp_use.client.task_managers.websocket.logger")
    async def test_close_connection_error_handling(self, mock_logger, mock_websocket_client):
        """Test that errors during close are handled gracefully."""
        url = "ws://localhost:8080"
        manager = WebSocketConnectionManager(url)

        # Establish connection first
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_ctx.__aexit__ = AsyncMock(side_effect=RuntimeError("Close error"))
        mock_websocket_client.return_value = mock_ctx

        await manager._establish_connection()
        await manager._close_connection()

        # Error should be logged but not raised
        mock_logger.warning.assert_called()
        assert manager._ws_ctx is None

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.websocket.websocket_client")
    async def test_close_without_connection(self, mock_websocket_client):
        """Test closing when no connection exists."""
        url = "ws://localhost:8080"
        manager = WebSocketConnectionManager(url)

        # Should not raise
        await manager._close_connection()

        assert manager._ws_ctx is None


class TestWebSocketConnectionManagerLifecycle:
    """Tests for full connection lifecycle."""

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.websocket.websocket_client")
    async def test_full_lifecycle(self, mock_websocket_client):
        """Test complete connection lifecycle."""
        url = "ws://localhost:8080"
        manager = WebSocketConnectionManager(url)

        # Mock the context manager
        mock_ctx = MagicMock()
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(mock_read_stream, mock_write_stream))
        mock_ctx.__aexit__ = AsyncMock()
        mock_websocket_client.return_value = mock_ctx

        # Start connection
        connection = await manager.start()
        assert connection == (mock_read_stream, mock_write_stream)
        assert manager.get_streams() == (mock_read_stream, mock_write_stream)

        # Stop connection
        await manager.stop()
        assert manager.get_streams() is None
        mock_ctx.__aexit__.assert_called_once()

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.websocket.websocket_client")
    async def test_start_stop_multiple_times(self, mock_websocket_client):
        """Test starting and stopping multiple times."""
        url = "ws://localhost:8080"
        manager = WebSocketConnectionManager(url)

        mock_ctx1 = MagicMock()
        mock_ctx1.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_ctx1.__aexit__ = AsyncMock()

        mock_ctx2 = MagicMock()
        mock_ctx2.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_ctx2.__aexit__ = AsyncMock()

        mock_websocket_client.side_effect = [mock_ctx1, mock_ctx2]

        # First connection
        await manager.start()
        await manager.stop()

        # Second connection
        await manager.start()
        await manager.stop()

        assert mock_websocket_client.call_count == 2
