"""
Unit tests for the SandboxConnector class.
"""

import os
import sys
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest

# Use MagicMock instead of importing from mcp.types
# from mcp.types import CallToolResult, Tool
from mcp_use.connectors.sandbox import SandboxConnector
from mcp_use.task_managers import SseConnectionManager
from mcp_use.types.sandbox import SandboxOptions


# Mock the sandbox module for tests
class MockCommandHandle:
    def __init__(self):
        self.exit_code = 0
        self.is_completed = True

    def kill(self):
        pass


class MockSandbox:
    def __init__(self, *args, **kwargs):
        self.commands = MagicMock()
        self.commands.run = MagicMock(return_value=MockCommandHandle())

    def get_host(self, port):
        return "test-host.sandbox.e2b.dev"

    def kill(self):
        pass


@pytest.fixture(autouse=True)
def mock_logger():
    """Mock the logger to prevent errors during tests."""
    with (
        patch("mcp_use.connectors.base.logger") as mock_base_logger,
        patch("mcp_use.connectors.sandbox.logger") as mock_sandbox_logger,
    ):
        # Set level attribute to an integer for comparison in the logger
        mock_sandbox_logger.handlers = []
        mock_base_logger.handlers = []
        yield mock_sandbox_logger


@pytest.fixture
def mock_sandbox_modules():
    """Mock the E2B sandbox modules."""
    with (
        patch("mcp_use.connectors.sandbox.Sandbox", MockSandbox),
        patch("mcp_use.connectors.sandbox.CommandHandle", MockCommandHandle),
    ):
        yield


@pytest.fixture
def mock_os_environ():
    """Fixture to mock os.environ."""
    with patch.dict(os.environ, {"E2B_API_KEY": "test-api-key"}, clear=False):
        yield


class TestSandboxConnectorInitialization:
    """Tests for SandboxConnector initialization."""

    def test_init_with_api_key(self, mock_sandbox_modules):
        """Test initialization with API key in sandbox options."""
        sandbox_options = SandboxOptions(api_key="test-api-key")
        connector = SandboxConnector("npx", ["test-command"], e2b_options=sandbox_options)

        assert connector.api_key == "test-api-key"
        assert connector.sandbox_template_id == "base"
        assert connector.supergateway_cmd_parts == "npx -y supergateway"
        assert connector.user_command == "npx"
        assert connector.user_args == ["test-command"]
        assert not connector._connected

    def test_init_with_env_api_key(self, mock_sandbox_modules, mock_os_environ):
        """Test initialization with API key from environment."""
        connector = SandboxConnector("npx", ["test-command"])

        assert connector.api_key == "test-api-key"
        assert connector.sandbox_template_id == "base"
        assert connector.user_command == "npx"
        assert connector.user_args == ["test-command"]
        assert not connector._connected

    def test_init_missing_api_key(self, mock_sandbox_modules):
        """Test initialization fails with missing API key."""
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(ValueError, match="E2B API key is required"):
                SandboxConnector("npx", ["test-command"])

    def test_init_with_custom_options(self, mock_sandbox_modules):
        """Test initialization with custom sandbox options."""
        sandbox_options = SandboxOptions(
            api_key="test-api-key",
            sandbox_template_id="custom-template",
            supergateway_command="custom-gateway-command",
        )
        connector = SandboxConnector("npx", ["test-command"], e2b_options=sandbox_options)

        assert connector.api_key == "test-api-key"
        assert connector.sandbox_template_id == "custom-template"
        assert connector.supergateway_cmd_parts == "custom-gateway-command"


class TestSandboxConnectorConnection:
    """Tests for SandboxConnector connection methods."""

    @pytest.mark.asyncio
    @patch("mcp_use.connectors.sandbox.SseConnectionManager")
    @patch("mcp_use.connectors.sandbox.ClientSession")
    async def test_connect(self, mock_client_session, mock_connection_manager, mock_sandbox_modules):
        """Test connecting to the MCP implementation in sandbox."""
        # Setup mocks
        mock_manager_instance = Mock(spec=SseConnectionManager)
        mock_manager_instance.start = AsyncMock(return_value=("read_stream", "write_stream"))
        mock_connection_manager.return_value = mock_manager_instance

        mock_client_instance = Mock()
        mock_client_instance.__aenter__ = AsyncMock()
        mock_client_session.return_value = mock_client_instance

        # Mock wait_for_server_response to avoid actual HTTP calls
        with patch.object(SandboxConnector, "wait_for_server_response", new_callable=AsyncMock, return_value=True):
            # Create connector and connect
            sandbox_options = SandboxOptions(api_key="test-api-key")
            connector = SandboxConnector("npx", ["test-command"], e2b_options=sandbox_options)
            await connector.connect()

            # Verify sandbox creation
            assert connector.sandbox is not None

            # Verify connection manager creation and start
            mock_connection_manager.assert_called_once()
            mock_manager_instance.start.assert_called_once()

            # Verify client session creation
            mock_client_session.assert_called_once_with("read_stream", "write_stream", sampling_callback=None)
            mock_client_instance.__aenter__.assert_called_once()

            # Verify state
            assert connector._connected is True
            assert connector.client_session == mock_client_instance
            assert connector._connection_manager == mock_manager_instance
            assert connector.base_url == "https://test-host.sandbox.e2b.dev"

    @pytest.mark.asyncio
    async def test_connect_already_connected(self, mock_sandbox_modules):
        """Test connecting when already connected."""
        sandbox_options = SandboxOptions(api_key="test-api-key")
        connector = SandboxConnector("npx", ["test-command"], e2b_options=sandbox_options)
        connector._connected = True

        await connector.connect()

        # Verify no connection established since already connected
        assert connector._connection_manager is None
        assert connector.client_session is None
        assert connector.sandbox is None

    @pytest.mark.asyncio
    @patch("mcp_use.connectors.sandbox.logger")
    @patch("mcp_use.connectors.sandbox.Sandbox")
    async def test_connect_error(self, mock_sandbox_class, mock_logger, mock_sandbox_modules):
        """Test connection error handling."""
        # Setup mocks to raise an exception during sandbox creation
        mock_sandbox_instance = MagicMock()
        mock_sandbox_instance.get_host.side_effect = Exception("Sandbox creation error")
        mock_sandbox_class.return_value = mock_sandbox_instance

        # Create connector and attempt to connect
        sandbox_options = SandboxOptions(api_key="test-api-key")
        connector = SandboxConnector("npx", ["test-command"], e2b_options=sandbox_options)

        # Mock cleanup to avoid errors during exception handling
        connector._cleanup_resources = AsyncMock()

        # Expect the exception to be re-raised
        with pytest.raises(Exception):
            await connector.connect()

        # Verify resources were cleaned up
        connector._cleanup_resources.assert_called_once()
        assert connector._connected is False
        assert connector.client_session is None

    @pytest.mark.asyncio
    async def test_disconnect(self, mock_sandbox_modules):
        """Test disconnecting from MCP implementation."""
        sandbox_options = SandboxOptions(api_key="test-api-key")
        connector = SandboxConnector("npx", ["test-command"], e2b_options=sandbox_options)
        connector._connected = True

        # Mock the _cleanup_resources method to replace the actual method
        connector._cleanup_resources = AsyncMock()

        # Disconnect
        await connector.disconnect()

        # Verify _cleanup_resources was called
        connector._cleanup_resources.assert_called_once()

        # Verify state
        assert connector._connected is False


class TestSandboxConnectorCleanup:
    """Tests for SandboxConnector cleanup methods."""

    @pytest.mark.asyncio
    async def test_cleanup_resources(self, mock_sandbox_modules):
        """Test cleanup of all resources."""
        # Create connector with resources to clean up
        sandbox_options = SandboxOptions(api_key="test-api-key")
        connector = SandboxConnector("npx", ["test-command"], e2b_options=sandbox_options)

        # Set up mock resources
        process_mock = MagicMock()
        process_mock.kill = MagicMock()
        connector.process = process_mock

        sandbox_mock = MagicMock()
        sandbox_mock.kill = MagicMock()
        connector.sandbox = sandbox_mock

        # Mock super()._cleanup_resources method
        with patch(
            "mcp_use.connectors.base.BaseConnector._cleanup_resources", new_callable=AsyncMock
        ) as mock_super_cleanup:
            # Call cleanup
            await connector._cleanup_resources()

            # Verify process was terminated
            process_mock.kill.assert_called_once()

            # Verify sandbox was closed
            sandbox_mock.kill.assert_called_once()

            # Verify parent cleanup was called
            mock_super_cleanup.assert_called_once()

            # Verify state changes
            assert connector.sandbox is None
            assert connector.process is None
            assert connector.stdout_lines == []
            assert connector.stderr_lines == []
            assert connector.base_url is None

    @pytest.mark.asyncio
    @patch("mcp_use.connectors.sandbox.logger")
    async def test_cleanup_resources_with_exceptions(self, mock_logger, mock_sandbox_modules):
        """Test cleanup handles exceptions gracefully."""
        # Create connector with resources to clean up
        sandbox_options = SandboxOptions(api_key="test-api-key")
        connector = SandboxConnector("npx", ["test-command"], e2b_options=sandbox_options)

        # Set up mock resources that will raise exceptions
        process_mock = MagicMock()
        process_mock.kill = MagicMock(side_effect=Exception("Process kill error"))
        connector.process = process_mock

        sandbox_mock = MagicMock()
        sandbox_mock.kill = MagicMock(side_effect=Exception("Sandbox kill error"))
        connector.sandbox = sandbox_mock

        # Configure logger to avoid test errors
        mock_logger.warning = MagicMock()

        # Mock super()._cleanup_resources method
        with patch(
            "mcp_use.connectors.base.BaseConnector._cleanup_resources", new_callable=AsyncMock
        ) as mock_super_cleanup:
            # Call cleanup
            await connector._cleanup_resources()

            # Verify process termination was attempted even though it errored
            process_mock.kill.assert_called_once()

            # Verify sandbox close was attempted even though it errored
            sandbox_mock.kill.assert_called_once()

            # Verify warnings were logged
            assert mock_logger.warning.call_count == 2

            # Verify parent cleanup was still called
            mock_super_cleanup.assert_called_once()

            # Verify state changes
            assert connector.sandbox is None
            assert connector.process is None
            assert connector.stdout_lines == []
            assert connector.stderr_lines == []
            assert connector.base_url is None
