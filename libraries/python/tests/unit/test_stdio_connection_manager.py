"""
Unit tests for StdioConnectionManager.
"""

import sys
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest
from mcp import StdioServerParameters

from mcp_use.client.task_managers.stdio import StdioConnectionManager


class TestStdioConnectionManagerInitialization:
    """Tests for StdioConnectionManager initialization."""

    def test_init_with_server_params(self):
        """Test initialization with server parameters."""
        server_params = StdioServerParameters(
            command="test-command",
            args=["--arg1", "--arg2"],
        )
        manager = StdioConnectionManager(server_params)

        assert manager.server_params == server_params
        assert manager.errlog == sys.stderr
        assert manager._stdio_ctx is None

    def test_init_with_custom_errlog(self):
        """Test initialization with custom error log."""
        server_params = StdioServerParameters(command="test-command")
        custom_errlog = Mock()

        manager = StdioConnectionManager(server_params, errlog=custom_errlog)

        assert manager.errlog == custom_errlog

    def test_init_defaults(self):
        """Test initialization with default parameters."""
        server_params = StdioServerParameters(command="test-command")

        manager = StdioConnectionManager(server_params)

        assert manager.errlog == sys.stderr


class TestStdioConnectionManagerConnection:
    """Tests for connection establishment and closure."""

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.stdio.stdio_client")
    async def test_establish_connection_success(self, mock_stdio_client):
        """Test successful connection establishment."""
        server_params = StdioServerParameters(command="test-command")
        manager = StdioConnectionManager(server_params)

        # Mock the context manager
        mock_ctx = MagicMock()
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(mock_read_stream, mock_write_stream))
        mock_stdio_client.return_value = mock_ctx

        connection = await manager._establish_connection()

        assert connection == (mock_read_stream, mock_write_stream)
        assert manager._stdio_ctx == mock_ctx
        mock_stdio_client.assert_called_once_with(server_params, sys.stderr)
        mock_ctx.__aenter__.assert_called_once()

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.stdio.stdio_client")
    async def test_establish_connection_with_custom_errlog(self, mock_stdio_client):
        """Test connection establishment with custom error log."""
        server_params = StdioServerParameters(command="test-command")
        custom_errlog = Mock()
        manager = StdioConnectionManager(server_params, errlog=custom_errlog)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_stdio_client.return_value = mock_ctx

        await manager._establish_connection()

        mock_stdio_client.assert_called_once_with(server_params, custom_errlog)

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.stdio.stdio_client")
    async def test_establish_connection_failure(self, mock_stdio_client):
        """Test connection establishment failure."""
        server_params = StdioServerParameters(command="test-command")
        manager = StdioConnectionManager(server_params)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(side_effect=OSError("Failed to start process"))
        mock_stdio_client.return_value = mock_ctx

        with pytest.raises(OSError, match="Failed to start process"):
            await manager._establish_connection()

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.stdio.stdio_client")
    async def test_close_connection_success(self, mock_stdio_client):
        """Test successful connection closure."""
        server_params = StdioServerParameters(command="test-command")
        manager = StdioConnectionManager(server_params)

        # Establish connection first
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_ctx.__aexit__ = AsyncMock()
        mock_stdio_client.return_value = mock_ctx

        await manager._establish_connection()
        await manager._close_connection()

        mock_ctx.__aexit__.assert_called_once_with(None, None, None)
        assert manager._stdio_ctx is None

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.stdio.stdio_client")
    @patch("mcp_use.client.task_managers.stdio.logger")
    async def test_close_connection_error_handling(self, mock_logger, mock_stdio_client):
        """Test that errors during close are handled gracefully."""
        server_params = StdioServerParameters(command="test-command")
        manager = StdioConnectionManager(server_params)

        # Establish connection first
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_ctx.__aexit__ = AsyncMock(side_effect=RuntimeError("Close error"))
        mock_stdio_client.return_value = mock_ctx

        await manager._establish_connection()
        await manager._close_connection()

        # Error should be logged but not raised
        mock_logger.warning.assert_called()
        assert manager._stdio_ctx is None

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.stdio.stdio_client")
    async def test_close_without_connection(self, mock_stdio_client):
        """Test closing when no connection exists."""
        server_params = StdioServerParameters(command="test-command")
        manager = StdioConnectionManager(server_params)

        # Should not raise
        await manager._close_connection()

        assert manager._stdio_ctx is None


class TestStdioConnectionManagerLifecycle:
    """Tests for full connection lifecycle."""

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.stdio.stdio_client")
    async def test_full_lifecycle(self, mock_stdio_client):
        """Test complete connection lifecycle."""
        server_params = StdioServerParameters(command="test-command")
        manager = StdioConnectionManager(server_params)

        # Mock the context manager
        mock_ctx = MagicMock()
        mock_read_stream = Mock()
        mock_write_stream = Mock()
        mock_ctx.__aenter__ = AsyncMock(return_value=(mock_read_stream, mock_write_stream))
        mock_ctx.__aexit__ = AsyncMock()
        mock_stdio_client.return_value = mock_ctx

        # Start connection
        connection = await manager.start()
        assert connection == (mock_read_stream, mock_write_stream)
        assert manager.get_streams() == (mock_read_stream, mock_write_stream)

        # Stop connection
        await manager.stop()
        assert manager.get_streams() is None
        mock_ctx.__aexit__.assert_called_once()

    @pytest.mark.asyncio
    @patch("mcp_use.client.task_managers.stdio.stdio_client")
    async def test_start_stop_multiple_times(self, mock_stdio_client):
        """Test starting and stopping multiple times."""
        server_params = StdioServerParameters(command="test-command")
        manager = StdioConnectionManager(server_params)

        mock_ctx1 = MagicMock()
        mock_ctx1.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_ctx1.__aexit__ = AsyncMock()

        mock_ctx2 = MagicMock()
        mock_ctx2.__aenter__ = AsyncMock(return_value=(Mock(), Mock()))
        mock_ctx2.__aexit__ = AsyncMock()

        mock_stdio_client.side_effect = [mock_ctx1, mock_ctx2]

        # First connection
        await manager.start()
        await manager.stop()

        # Second connection
        await manager.start()
        await manager.stop()

        assert mock_stdio_client.call_count == 2
