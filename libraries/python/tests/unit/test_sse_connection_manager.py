"""
Unit tests for SseConnectionManager.
"""

from unittest.mock import AsyncMock, MagicMock, Mock, patch

import httpx
import pytest

from mcp_use.client.task_managers.sse import SseConnectionManager


class TestSseConnectionManagerInitialization:
    """Tests for SseConnectionManager initialization."""

    def test_init_with_url_only(self):
        """Test initialization with URL only."""
        url = "http://localhost:8080/sse"
        manager = SseConnectionManager(url)

        assert manager.url == url
        assert manager.headers == {}
        assert manager.timeout == 5
        assert manager.sse_read_timeout == 60 * 5
        assert manager.auth is None
        assert manager.httpx_client_factory is None
        assert manager._sse_ctx is None

    def test_init_with_all_parameters(self):
        """Test initialization with all parameters."""
        url = "http://localhost:8080/sse"
        headers = {"Authorization": "Bearer token"}
        timeout = 10.0
        sse_read_timeout = 120.0
        auth = httpx.BasicAuth("user", "pass")
        client_factory = Mock()

        manager = SseConnectionManager(
            url=url,
            headers=headers,
            timeout=timeout,
            sse_read_timeout=sse_read_timeout,
            auth=auth,
            httpx_client_factory=client_factory,
        )

        assert manager.url == url
        assert manager.headers == headers
        assert manager.timeout == timeout
        assert manager.sse_read_timeout == sse_read_timeout
        assert manager.auth == auth
        assert manager.httpx_client_factory == client_factory

    def test_init_with_none_headers(self):
        """Test initialization with None headers."""
        url = "http://localhost:8080/sse"
        manager = SseConnectionManager(url, headers=None)

        assert manager.headers == {}


class TestSseConnectionManagerConnection:
    """Tests for connection establishment and closure."""

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.sse.sse_client")
    async def test_establish_connection_success(self, mock_sse_client):
        """Test successful connection establishment."""
        url = "http://localhost:8080/sse"
        manager = SseConnectionManager(url)

        # Mock the context manager
        mock_ctx = MagicMock()
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(mock_read_stream, mock_write_stream))
        mock_sse_client.return_value = mock_ctx

        connection = await manager._establish_connection()

        assert connection == (mock_read_stream, mock_write_stream)
        assert manager._sse_ctx == mock_ctx
        mock_sse_client.assert_called_once_with(
            url=url,
            headers={},
            timeout=5,
            sse_read_timeout=60 * 5,
            auth=None,
            httpx_client_factory=None,
        )
        mock_ctx.__aenter__.assert_called_once()

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.sse.sse_client")
    async def test_establish_connection_with_all_params(self, mock_sse_client):
        """Test connection establishment with all parameters."""
        url = "http://localhost:8080/sse"
        headers = {"Authorization": "Bearer token"}
        timeout = 10.0
        sse_read_timeout = 120.0
        auth = httpx.BasicAuth("user", "pass")
        client_factory = Mock()

        manager = SseConnectionManager(
            url=url,
            headers=headers,
            timeout=timeout,
            sse_read_timeout=sse_read_timeout,
            auth=auth,
            httpx_client_factory=client_factory,
        )

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_sse_client.return_value = mock_ctx

        await manager._establish_connection()

        mock_sse_client.assert_called_once_with(
            url=url,
            headers=headers,
            timeout=timeout,
            sse_read_timeout=sse_read_timeout,
            auth=auth,
            httpx_client_factory=client_factory,
        )

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.sse.sse_client")
    async def test_establish_connection_failure(self, mock_sse_client):
        """Test connection establishment failure."""
        url = "http://localhost:8080/sse"
        manager = SseConnectionManager(url)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(side_effect=httpx.ConnectError("Connection failed"))
        mock_sse_client.return_value = mock_ctx

        with pytest.raises(httpx.ConnectError, match="Connection failed"):
            await manager._establish_connection()

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.sse.sse_client")
    async def test_close_connection_success(self, mock_sse_client):
        """Test successful connection closure."""
        url = "http://localhost:8080/sse"
        manager = SseConnectionManager(url)

        # Establish connection first
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_ctx.__aexit__ = AsyncMock()
        mock_sse_client.return_value = mock_ctx

        await manager._establish_connection()
        await manager._close_connection()

        mock_ctx.__aexit__.assert_called_once_with(None, None, None)
        assert manager._sse_ctx is None

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.sse.sse_client")
    @patch("mcp_use.client.task_managers.sse.logger")
    async def test_close_connection_error_handling(self, mock_logger, mock_sse_client):
        """Test that errors during close are handled gracefully."""
        url = "http://localhost:8080/sse"
        manager = SseConnectionManager(url)

        # Establish connection first
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_ctx.__aexit__ = AsyncMock(side_effect=RuntimeError("Close error"))
        mock_sse_client.return_value = mock_ctx

        await manager._establish_connection()
        await manager._close_connection()

        # Error should be logged but not raised
        mock_logger.warning.assert_called()
        assert manager._sse_ctx is None

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.sse.sse_client")
    async def test_close_without_connection(self, mock_sse_client):
        """Test closing when no connection exists."""
        url = "http://localhost:8080/sse"
        manager = SseConnectionManager(url)

        # Should not raise
        await manager._close_connection()

        assert manager._sse_ctx is None


class TestSseConnectionManagerLifecycle:
    """Tests for full connection lifecycle."""

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.sse.sse_client")
    async def test_full_lifecycle(self, mock_sse_client):
        """Test complete connection lifecycle."""
        url = "http://localhost:8080/sse"
        manager = SseConnectionManager(url)

        # Mock the context manager
        mock_ctx = MagicMock()
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(mock_read_stream, mock_write_stream))
        mock_ctx.__aexit__ = AsyncMock()
        mock_sse_client.return_value = mock_ctx

        # Start connection
        connection = await manager.start()
        assert connection == (mock_read_stream, mock_write_stream)
        assert manager.get_streams() == (mock_read_stream, mock_write_stream)

        # Stop connection
        await manager.stop()
        assert manager.get_streams() is None
        mock_ctx.__aexit__.assert_called_once()

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.sse.sse_client")
    async def test_start_stop_multiple_times(self, mock_sse_client):
        """Test starting and stopping multiple times."""
        url = "http://localhost:8080/sse"
        manager = SseConnectionManager(url)

        mock_ctx1 = MagicMock()
        mock_ctx1.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_ctx1.__aexit__ = AsyncMock()

        mock_ctx2 = MagicMock()
        mock_ctx2.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_ctx2.__aexit__ = AsyncMock()

        mock_sse_client.side_effect = [mock_ctx1, mock_ctx2]

        # First connection
        await manager.start()
        await manager.stop()

        # Second connection
        await manager.start()
        await manager.stop()

        assert mock_sse_client.call_count == 2
