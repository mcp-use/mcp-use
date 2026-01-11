"""
Unit tests for MCP client capabilities exposure.

These tests verify that the mcp-use library correctly exposes client capabilities
to MCP servers during the initialization handshake.
"""

from unittest.mock import ANY, AsyncMock, MagicMock, Mock, patch

import pytest
from mcp.types import ListRootsResult, Root

from mcp_use.client.connectors.base import BaseConnector
from mcp_use.client.connectors.http import HttpConnector
from mcp_use.client.connectors.stdio import StdioConnector


@pytest.fixture(autouse=True)
def mock_logger():
    """Mock the logger to prevent errors during tests."""
    with patch("mcp_use.client.connectors.base.logger") as mock_base_logger:
        with patch("mcp_use.client.connectors.stdio.logger"):
            with patch("mcp_use.client.connectors.http.logger"):
                yield mock_base_logger


class TestRootsCapability:
    """Tests for roots capability exposure."""

    def test_list_roots_callback_always_provided(self):
        """Test that list_roots_callback property always returns a callback.

        This ensures the roots capability is always advertised to servers.
        """
        connector = StdioConnector()

        # list_roots_callback should always return a callable
        callback = connector.list_roots_callback
        assert callable(callback)

    def test_default_roots_empty(self):
        """Test that roots are empty by default."""
        connector = StdioConnector()

        roots = connector.get_roots()
        assert roots == []

    def test_init_with_roots(self):
        """Test initialization with roots parameter."""
        initial_roots = [
            Root(uri="file:///home/user/project", name="My Project"),
            Root(uri="file:///home/user/data"),
        ]

        connector = StdioConnector(roots=initial_roots)

        roots = connector.get_roots()
        assert len(roots) == 2
        assert str(roots[0].uri) == "file:///home/user/project"
        assert roots[0].name == "My Project"
        assert str(roots[1].uri) == "file:///home/user/data"

    @pytest.mark.asyncio
    async def test_set_roots_updates_cache(self):
        """Test that set_roots() updates the internal roots cache."""
        connector = StdioConnector()

        new_roots = [
            Root(uri="file:///new/path", name="New Root"),
        ]

        await connector.set_roots(new_roots)

        roots = connector.get_roots()
        assert len(roots) == 1
        assert str(roots[0].uri) == "file:///new/path"
        assert roots[0].name == "New Root"

    @pytest.mark.asyncio
    async def test_set_roots_sends_notification_when_connected(self):
        """Test that set_roots() sends notification when connected."""
        connector = StdioConnector()
        connector._connected = True

        # Mock the client session
        mock_session = MagicMock()
        mock_session.send_roots_list_changed = AsyncMock()
        connector.client_session = mock_session

        new_roots = [Root(uri="file:///test/path")]
        await connector.set_roots(new_roots)

        # Verify notification was sent
        mock_session.send_roots_list_changed.assert_called_once()

    @pytest.mark.asyncio
    async def test_set_roots_no_notification_when_disconnected(self):
        """Test that set_roots() doesn't send notification when disconnected."""
        connector = StdioConnector()
        connector._connected = False

        # Mock the client session
        mock_session = MagicMock()
        mock_session.send_roots_list_changed = AsyncMock()
        connector.client_session = mock_session

        new_roots = [Root(uri="file:///test/path")]
        await connector.set_roots(new_roots)

        # Verify notification was NOT sent
        mock_session.send_roots_list_changed.assert_not_called()

    @pytest.mark.asyncio
    async def test_internal_list_roots_callback_returns_roots(self):
        """Test that the internal callback returns the cached roots."""
        initial_roots = [
            Root(uri="file:///home/user/project", name="My Project"),
        ]

        connector = StdioConnector(roots=initial_roots)

        # Create a mock context
        mock_context = MagicMock()

        # Call the internal callback
        result = await connector._internal_list_roots_callback(mock_context)

        assert isinstance(result, ListRootsResult)
        assert len(result.roots) == 1
        assert str(result.roots[0].uri) == "file:///home/user/project"

    @pytest.mark.asyncio
    async def test_custom_list_roots_callback_takes_precedence(self):
        """Test that a custom list_roots_callback takes precedence."""
        custom_roots = [Root(uri="file:///custom/path", name="Custom")]

        async def custom_callback(context):
            return ListRootsResult(roots=custom_roots)

        connector = StdioConnector(
            roots=[Root(uri="file:///default/path")],  # Default roots
            list_roots_callback=custom_callback,
        )

        # Create a mock context
        mock_context = MagicMock()

        # Call the internal callback (which should delegate to custom)
        result = await connector._internal_list_roots_callback(mock_context)

        # Should return custom roots, not default
        assert len(result.roots) == 1
        assert str(result.roots[0].uri) == "file:///custom/path"
        assert result.roots[0].name == "Custom"

    def test_get_roots_returns_copy(self):
        """Test that get_roots() returns a copy, not the original list."""
        initial_roots = [Root(uri="file:///test/path")]
        connector = StdioConnector(roots=initial_roots)

        roots1 = connector.get_roots()
        roots2 = connector.get_roots()

        # Should be equal but not the same object
        assert roots1 == roots2
        assert roots1 is not roots2
        assert roots1 is not connector._roots


class TestCapabilitiesInClientSession:
    """Tests that verify capabilities are passed to ClientSession."""

    @pytest.mark.asyncio
    @patch("mcp_use.client.connectors.stdio.StdioConnectionManager")
    @patch("mcp_use.client.connectors.stdio.ClientSession")
    async def test_stdio_passes_list_roots_callback(self, mock_client_session, mock_connection_manager):
        """Test that StdioConnector passes list_roots_callback to ClientSession."""
        # Setup mocks
        mock_manager_instance = Mock()
        mock_manager_instance.start = AsyncMock(return_value=("read_stream", "write_stream"))
        mock_connection_manager.return_value = mock_manager_instance

        mock_client_instance = Mock()
        mock_client_instance.__aenter__ = AsyncMock()
        mock_client_session.return_value = mock_client_instance

        # Create connector and connect
        connector = StdioConnector()
        await connector.connect()

        # Verify list_roots_callback was passed
        call_kwargs = mock_client_session.call_args
        assert "list_roots_callback" in call_kwargs.kwargs or (
            len(call_kwargs.args) > 4 and call_kwargs.args[4] is not None
        )

        # Get the actual callback that was passed
        if call_kwargs.kwargs.get("list_roots_callback"):
            passed_callback = call_kwargs.kwargs["list_roots_callback"]
        else:
            # Find it in positional args
            passed_callback = None
            for arg in call_kwargs.args:
                if callable(arg) and arg.__name__ == "_internal_list_roots_callback":
                    passed_callback = arg
                    break

        # The callback should be the connector's list_roots_callback
        assert passed_callback is not None

    @pytest.mark.asyncio
    @patch("mcp_use.client.connectors.http.StreamableHttpConnectionManager")
    @patch("mcp_use.client.connectors.http.ClientSession")
    async def test_http_passes_list_roots_callback(self, mock_client_session, mock_cm_class):
        """Test that HttpConnector passes list_roots_callback to ClientSession."""
        # Setup mocks
        mock_cm_instance = MagicMock()
        mock_cm_instance.start = AsyncMock(return_value=("read_stream", "write_stream"))
        mock_cm_instance.close = AsyncMock()
        mock_cm_class.return_value = mock_cm_instance

        mock_client_instance = MagicMock()
        mock_client_instance.__aenter__ = AsyncMock()
        mock_client_instance.__aexit__ = AsyncMock()
        mock_client_instance.initialize = AsyncMock()
        mock_init_result = MagicMock()
        mock_init_result.capabilities = MagicMock(tools=False, resources=False, prompts=False)
        mock_client_instance.initialize.return_value = mock_init_result
        mock_client_session.return_value = mock_client_instance

        # Create connector and connect
        connector = HttpConnector("http://localhost:8000")
        await connector.connect()

        # Verify list_roots_callback was passed
        mock_client_session.assert_called_once()
        call_kwargs = mock_client_session.call_args

        # Check kwargs
        assert call_kwargs.kwargs.get("list_roots_callback") is not None


class TestSamplingAndElicitationCapabilities:
    """Tests for sampling and elicitation capability exposure."""

    def test_sampling_callback_stored(self):
        """Test that sampling_callback is stored when provided."""

        async def my_sampling_callback(params):
            pass

        connector = StdioConnector(sampling_callback=my_sampling_callback)
        assert connector.sampling_callback is my_sampling_callback

    def test_elicitation_callback_stored(self):
        """Test that elicitation_callback is stored when provided."""

        async def my_elicitation_callback(params):
            pass

        connector = StdioConnector(elicitation_callback=my_elicitation_callback)
        assert connector.elicitation_callback is my_elicitation_callback

    @pytest.mark.asyncio
    @patch("mcp_use.client.connectors.stdio.StdioConnectionManager")
    @patch("mcp_use.client.connectors.stdio.ClientSession")
    async def test_all_callbacks_passed_to_client_session(self, mock_client_session, mock_connection_manager):
        """Test that all capability callbacks are passed to ClientSession."""
        # Setup mocks
        mock_manager_instance = Mock()
        mock_manager_instance.start = AsyncMock(return_value=("read_stream", "write_stream"))
        mock_connection_manager.return_value = mock_manager_instance

        mock_client_instance = Mock()
        mock_client_instance.__aenter__ = AsyncMock()
        mock_client_session.return_value = mock_client_instance

        # Create callbacks
        async def sampling_cb(params):
            pass

        async def elicitation_cb(params):
            pass

        # Create connector with all callbacks
        connector = StdioConnector(
            sampling_callback=sampling_cb,
            elicitation_callback=elicitation_cb,
        )
        await connector.connect()

        # Verify all callbacks were passed
        call_kwargs = mock_client_session.call_args.kwargs
        assert call_kwargs.get("sampling_callback") is sampling_cb
        assert call_kwargs.get("elicitation_callback") is elicitation_cb
        assert call_kwargs.get("list_roots_callback") is not None
