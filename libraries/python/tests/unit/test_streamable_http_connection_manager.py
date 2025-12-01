"""
Unit tests for StreamableHttpConnectionManager.
"""

from unittest.mock import AsyncMock, MagicMock, Mock, patch

import httpx
import pytest

from mcp_use.client.task_managers.streamable_http import StreamableHttpConnectionManager


class TestStreamableHttpConnectionManagerInitialization:
    """Tests for StreamableHttpConnectionManager initialization."""

    def test_init_with_url_only(self):
        """Test initialization with URL only."""
        url = "http://localhost:8080/api"
        manager = StreamableHttpConnectionManager(url)

        assert manager.url == url
        assert manager.headers == {}
        assert manager.timeout.total_seconds() == 5
        assert manager.read_timeout.total_seconds() == 60 * 5
        assert manager.auth is None
        assert manager.httpx_client_factory is None
        assert manager._http_ctx is None

    def test_init_with_all_parameters(self):
        """Test initialization with all parameters."""
        url = "http://localhost:8080/api"
        headers = {"Authorization": "Bearer token"}
        timeout = 10.0
        read_timeout = 120.0
        auth = httpx.BasicAuth("user", "pass")
        client_factory = Mock()

        manager = StreamableHttpConnectionManager(
            url=url,
            headers=headers,
            timeout=timeout,
            read_timeout=read_timeout,
            auth=auth,
            httpx_client_factory=client_factory,
        )

        assert manager.url == url
        assert manager.headers == headers
        assert manager.timeout.total_seconds() == timeout
        assert manager.read_timeout.total_seconds() == read_timeout
        assert manager.auth == auth
        assert manager.httpx_client_factory == client_factory

    def test_init_with_none_headers(self):
        """Test initialization with None headers."""
        url = "http://localhost:8080/api"
        manager = StreamableHttpConnectionManager(url, headers=None)

        assert manager.headers == {}


class TestStreamableHttpConnectionManagerConnection:
    """Tests for connection establishment and closure."""

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.streamable_http.streamablehttp_client")
    async def test_establish_connection_success(self, mock_http_client):
        """Test successful connection establishment."""
        url = "http://localhost:8080/api"
        manager = StreamableHttpConnectionManager(url)

        # Mock the context manager
        mock_ctx = MagicMock()
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_session_id_callback = Mock()
        mock_ctx.__aenter__ = AsyncMock(
            return_value=(mock_read_stream, mock_write_stream, mock_session_id_callback)
        )
        mock_http_client.return_value = mock_ctx

        connection = await manager._establish_connection()

        assert connection == (mock_read_stream, mock_write_stream)
        assert manager._http_ctx == mock_ctx
        mock_http_client.assert_called_once_with(
            url=url,
            headers={},
            timeout=manager.timeout,
            sse_read_timeout=manager.read_timeout,
            auth=None,
            httpx_client_factory=None,
        )
        mock_ctx.__aenter__.assert_called_once()

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.streamable_http.streamablehttp_client")
    async def test_establish_connection_with_all_params(self, mock_http_client):
        """Test connection establishment with all parameters."""
        url = "http://localhost:8080/api"
        headers = {"Authorization": "Bearer token"}
        timeout = 10.0
        read_timeout = 120.0
        auth = httpx.BasicAuth("user", "pass")
        client_factory = Mock()

        manager = StreamableHttpConnectionManager(
            url=url,
            headers=headers,
            timeout=timeout,
            read_timeout=read_timeout,
            auth=auth,
            httpx_client_factory=client_factory,
        )

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(Mock(), Mock(), Mock()))
        mock_http_client.return_value = mock_ctx

        await manager._establish_connection()

        mock_http_client.assert_called_once_with(
            url=url,
            headers=headers,
            timeout=manager.timeout,
            sse_read_timeout=manager.read_timeout,
            auth=auth,
            httpx_client_factory=client_factory,
        )

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.streamable_http.streamablehttp_client")
    async def test_establish_connection_failure(self, mock_http_client):
        """Test connection establishment failure."""
        url = "http://localhost:8080/api"
        manager = StreamableHttpConnectionManager(url)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(side_effect=httpx.ConnectError("Connection failed"))
        mock_http_client.return_value = mock_ctx

        with pytest.raises(httpx.ConnectError, match="Connection failed"):
            await manager._establish_connection()

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.streamable_http.streamablehttp_client")
    async def test_close_connection_success(self, mock_http_client):
        """Test successful connection closure."""
        url = "http://localhost:8080/api"
        manager = StreamableHttpConnectionManager(url)

        # Establish connection first
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(Mock(), Mock(), Mock()))
        mock_ctx.__aexit__ = AsyncMock()
        mock_http_client.return_value = mock_ctx

        await manager._establish_connection()
        await manager._close_connection()

        mock_ctx.__aexit__.assert_called_once_with(None, None, None)
        assert manager._http_ctx is None

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.streamable_http.streamablehttp_client")
    @patch("mcp_use.client.task_managers.streamable_http.logger")
    async def test_close_connection_error_handling(self, mock_logger, mock_http_client):
        """Test that errors during close are handled gracefully."""
        url = "http://localhost:8080/api"
        manager = StreamableHttpConnectionManager(url)

        # Establish connection first
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(Mock(), Mock(), Mock()))
        mock_ctx.__aexit__ = AsyncMock(side_effect=RuntimeError("Close error"))
        mock_http_client.return_value = mock_ctx

        await manager._establish_connection()
        await manager._close_connection()

        # Error should be logged but not raised (uses debug level)
        mock_logger.debug.assert_called()
        assert manager._http_ctx is None

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.streamable_http.streamablehttp_client")
    async def test_close_without_connection(self, mock_http_client):
        """Test closing when no connection exists."""
        url = "http://localhost:8080/api"
        manager = StreamableHttpConnectionManager(url)

        # Should not raise
        await manager._close_connection()

        assert manager._http_ctx is None


class TestStreamableHttpConnectionManagerLifecycle:
    """Tests for full connection lifecycle."""

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.streamable_http.streamablehttp_client")
    async def test_full_lifecycle(self, mock_http_client):
        """Test complete connection lifecycle."""
        url = "http://localhost:8080/api"
        manager = StreamableHttpConnectionManager(url)

        # Mock the context manager
        mock_ctx = MagicMock()
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(mock_read_stream, mock_write_stream, Mock()))
        mock_ctx.__aexit__ = AsyncMock()
        mock_http_client.return_value = mock_ctx

        # Start connection
        connection = await manager.start()
        assert connection == (mock_read_stream, mock_write_stream)
        assert manager.get_streams() == (mock_read_stream, mock_write_stream)

        # Stop connection
        await manager.stop()
        assert manager.get_streams() is None
        mock_ctx.__aexit__.assert_called_once()

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.streamable_http.streamablehttp_client")
    async def test_start_stop_multiple_times(self, mock_http_client):
        """Test starting and stopping multiple times."""
        url = "http://localhost:8080/api"
        manager = StreamableHttpConnectionManager(url)

        mock_ctx1 = MagicMock()
        mock_ctx1.__aenter__ = AsyncMock(return_value=(Mock(), Mock(), Mock()))
        mock_ctx1.__aexit__ = AsyncMock()

        mock_ctx2 = MagicMock()
        mock_ctx2.__aenter__ = AsyncMock(return_value=(Mock(), Mock(), Mock()))
        mock_ctx2.__aexit__ = AsyncMock()

        mock_http_client.side_effect = [mock_ctx1, mock_ctx2]

        # First connection
        await manager.start()
        await manager.stop()

        # Second connection
        await manager.start()
        await manager.stop()

        assert mock_http_client.call_count == 2
