"""
Unit tests for the MCPClient class.
"""

import json
import os
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_use.client import MCPClient
from mcp_use.connectors.base import BaseConnector


class TestMCPClientInitialization:
    """Tests for MCPClient initialization."""

    def test_init_empty(self):
        """Test initialization with no parameters."""
        client = MCPClient()

        assert client.config == {}
        assert client.connectors == {}
        assert client.active_connectors == []

    def test_init_with_dict_config(self):
        """Test initialization with a dictionary config."""
        config = {"mcpServers": {"test": {"url": "http://test.com"}}}
        client = MCPClient(config=config)

        assert client.config == config
        assert client.connectors == {}
        assert client.active_connectors == []

    def test_from_dict(self):
        """Test creation from a dictionary."""
        config = {"mcpServers": {"test": {"url": "http://test.com"}}}
        client = MCPClient.from_dict(config)

        assert client.config == config
        assert client.connectors == {}
        assert client.active_connectors == []

    def test_init_with_file_config(self):
        """Test initialization with a file config."""
        config = {"mcpServers": {"test": {"url": "http://test.com"}}}

        # Create a temporary file with test config
        with tempfile.NamedTemporaryFile(mode="w", delete=False) as temp:
            json.dump(config, temp)
            temp_path = temp.name

        try:
            # Test initialization with file path
            client = MCPClient(config=temp_path)

            assert client.config == config
            assert client.connectors == {}
            assert client.active_connectors == []
        finally:
            # Clean up temp file
            os.unlink(temp_path)

    def test_from_config_file(self):
        """Test creation from a config file."""
        config = {"mcpServers": {"test": {"url": "http://test.com"}}}

        # Create a temporary file with test config
        with tempfile.NamedTemporaryFile(mode="w", delete=False) as temp:
            json.dump(config, temp)
            temp_path = temp.name

        try:
            # Test creation from file path
            client = MCPClient.from_config_file(temp_path)

            assert client.config == config
            assert client.connectors == {}
            assert client.active_connectors == []
        finally:
            # Clean up temp file
            os.unlink(temp_path)


class TestMCPClientServerManagement:
    """Tests for MCPClient server management methods."""

    def test_add_server(self):
        """Test adding a server."""
        client = MCPClient()
        server_config = {"url": "http://test.com"}

        client.add_server("test", server_config)

        assert "mcpServers" in client.config
        assert client.config["mcpServers"]["test"] == server_config

    def test_add_server_to_existing(self):
        """Test adding a server to existing servers."""
        config = {"mcpServers": {"server1": {"url": "http://server1.com"}}}
        client = MCPClient(config=config)
        server_config = {"url": "http://test.com"}

        client.add_server("test", server_config)

        assert "mcpServers" in client.config
        assert client.config["mcpServers"]["server1"] == {"url": "http://server1.com"}
        assert client.config["mcpServers"]["test"] == server_config

    def test_remove_server(self):
        """Test removing a server."""
        config = {
            "mcpServers": {
                "server1": {"url": "http://server1.com"},
                "server2": {"url": "http://server2.com"},
            }
        }
        client = MCPClient(config=config)

        client.remove_server("server1")

        assert "mcpServers" in client.config
        assert "server1" not in client.config["mcpServers"]
        assert "server2" in client.config["mcpServers"]

    def test_remove_server_with_active_session(self):
        """Test removing a server with an active session."""
        config = {
            "mcpServers": {
                "server1": {"url": "http://server1.com"},
                "server2": {"url": "http://server2.com"},
            }
        }
        client = MCPClient(config=config)

        # Add an active connector
        client.active_connectors.append("server1")

        client.remove_server("server1")

        assert "mcpServers" in client.config
        assert "server1" not in client.config["mcpServers"]
        assert "server1" not in client.active_connectors
        assert "server2" in client.config["mcpServers"]

    def test_get_server_names(self):
        """Test getting server names."""
        config = {
            "mcpServers": {
                "server1": {"url": "http://server1.com"},
                "server2": {"url": "http://server2.com"},
            }
        }
        client = MCPClient(config=config)

        server_names = client.get_server_names()

        assert len(server_names) == 2
        assert "server1" in server_names
        assert "server2" in server_names

    def test_get_server_names_empty(self):
        """Test getting server names when there are none."""
        client = MCPClient()

        server_names = client.get_server_names()

        assert len(server_names) == 0


class TestMCPClientSaveConfig:
    """Tests for MCPClient save_config method."""

    def test_save_config(self):
        """Test saving the configuration to a file."""
        config = {"mcpServers": {"server1": {"url": "http://server1.com"}}}
        client = MCPClient(config=config)

        # Create a temporary file path
        with tempfile.NamedTemporaryFile(delete=False) as temp:
            temp_path = temp.name

        try:
            # Test saving config
            client.save_config(temp_path)

            # Check that the file was written correctly
            with open(temp_path) as f:
                saved_config = json.load(f)

            assert saved_config == config
        finally:
            # Clean up temp file
            os.unlink(temp_path)


class TestMCPClientConnectorManagement:
    """Tests for MCPClient connector management methods."""

    @pytest.mark.asyncio
    @patch("mcp_use.client.create_connector_from_config")
    async def test_create_connector(self, mock_create_connector):
        """Test creating a connector."""
        config = {"mcpServers": {"server1": {"url": "http://server1.com"}}}
        client = MCPClient(config=config)

        # Set up mocks
        mock_connector = MagicMock()
        mock_connector.initialize = AsyncMock()
        mock_create_connector.return_value = mock_connector

        # Test create_connector
        await client.create_connector("server1")

        # Verify behavior
        mock_create_connector.assert_called_once_with({"url": "http://server1.com"}, options={})
        mock_connector.initialize.assert_called_once()

        # Verify state changes
        assert client.connectors["server1"] == mock_connector
        assert "server1" in client.active_connectors

    @pytest.mark.asyncio
    async def test_create_connector_no_servers(self):
        """Test creating a connector when no servers are configured."""
        client = MCPClient()

        # Expect a UserWarning when no servers are configured
        with pytest.warns(UserWarning) as exc_info:
            await client.create_connector("server1")

        assert "No MCP servers defined in config" in str(exc_info[0].message)

    @pytest.mark.asyncio
    async def test_create_connector_nonexistent_server(self):
        """Test creating a connector for a non-existent server."""
        config = {"mcpServers": {"server1": {"url": "http://server1.com"}}}
        client = MCPClient(config=config)

        # Test create_connector raises ValueError
        with pytest.raises(ValueError) as exc_info:
            await client.create_connector("server2")

        assert "Server 'server2' not found in config" in str(exc_info.value)

    @pytest.mark.asyncio
    @patch("mcp_use.client.create_connector_from_config")
    async def test_create_connector_no_auto_initialize(self, mock_create_connector):
        """Test creating a connector without auto-initializing."""
        config = {"mcpServers": {"server1": {"url": "http://server1.com"}}}
        client = MCPClient(config=config)

        # Set up mocks
        mock_connector = MagicMock()
        mock_connector.initialize = AsyncMock()
        mock_create_connector.return_value = mock_connector

        # Test create_connector
        await client.create_connector("server1", auto_initialize=False)

        # Verify behavior
        mock_create_connector.assert_called_once_with({"url": "http://server1.com"}, options={})
        mock_connector.initialize.assert_not_called()

        # Verify state changes
        assert client.connectors["server1"] == mock_connector
        assert "server1" in client.active_connectors

    def test_get_connector(self):
        """Test getting an existing connector."""
        client = MCPClient()

        # Add a mock connector
        mock_connector = MagicMock(spec=BaseConnector)
        client.connectors["server1"] = mock_connector

        # Test get_connector
        connector = client.get_connector("server1")

        assert connector == mock_connector

    def test_get_connector_nonexistent(self):
        """Test getting a non-existent connector."""
        client = MCPClient()

        # Test get_connector raises ValueError
        with pytest.raises(ValueError) as exc_info:
            client.get_connector("server1")

        assert "No connector exists for server 'server1'" in str(exc_info.value)

    def test_get_all_active_connectors(self):
        """Test getting all active connectors."""
        client = MCPClient()

        # Add mock connectors
        mock_connector1 = MagicMock(spec=BaseConnector)
        mock_connector2 = MagicMock(spec=BaseConnector)
        client.connectors["server1"] = mock_connector1
        client.connectors["server2"] = mock_connector2
        client.active_connectors = ["server1", "server2"]

        # Test get_all_active_connectors
        connectors = client.get_all_active_connectors()

        assert len(connectors) == 2
        assert connectors["server1"] == mock_connector1
        assert connectors["server2"] == mock_connector2

    def test_get_all_active_connectors_some_inactive(self):
        """Test getting all active connectors when some are inactive."""
        client = MCPClient()

        # Add mock connectors
        mock_connector1 = MagicMock(spec=BaseConnector)
        mock_connector2 = MagicMock(spec=BaseConnector)
        client.connectors["server1"] = mock_connector1
        client.connectors["server2"] = mock_connector2
        client.active_connectors = ["server1"]  # Only server1 is active

        # Test get_all_active_connectors
        connectors = client.get_all_active_connectors()

        assert len(connectors) == 1
        assert connectors["server1"] == mock_connector1
        assert "server2" not in connectors

    @pytest.mark.asyncio
    async def test_close_connector(self):
        """Test closing a connector."""
        client = MCPClient()

        # Add a mock session
        mock_connector = MagicMock(spec=BaseConnector)
        mock_connector.disconnect = AsyncMock()
        client.connectors["server1"] = mock_connector
        client.active_connectors = ["server1"]

        # Test close_connector
        await client.close_connector("server1")

        # Verify behavior
        mock_connector.disconnect.assert_called_once()

        # Verify state changes
        assert "server1" not in client.connectors
        assert "server1" not in client.active_connectors

    @pytest.mark.asyncio
    async def test_close_connector_nonexistent(self):
        """Test closing a non-existent session."""
        client = MCPClient()

        # Test close_connector doesn't raise an exception
        await client.close_connector("server1")

        # State should remain unchanged
        assert "server1" not in client.connectors
        assert "server1" not in client.active_connectors

    @pytest.mark.asyncio
    async def test_close_all_connectors(self):
        """Test closing all connectors."""
        client = MCPClient()

        # Add mock sessions
        mock_connector1 = MagicMock(spec=BaseConnector)
        mock_connector1.disconnect = AsyncMock()
        mock_connector2 = MagicMock(spec=BaseConnector)
        mock_connector2.disconnect = AsyncMock()

        client.connectors["server1"] = mock_connector1
        client.connectors["server2"] = mock_connector2
        client.active_connectors = ["server1", "server2"]

        # Test close_all_connectors
        await client.close_all_connectors()

        # Verify behavior
        mock_connector1.disconnect.assert_called_once()
        mock_connector2.disconnect.assert_called_once()

        # Verify state changes
        assert len(client.connectors) == 0
        assert len(client.active_connectors) == 0

    @pytest.mark.asyncio
    async def test_close_all_connectors_one_fails(self):
        """Test closing all connectors when one fails."""
        client = MCPClient()

        # Add mock sessions, one that raises an exception
        mock_connector1 = MagicMock(spec=BaseConnector)
        mock_connector1.disconnect = AsyncMock(side_effect=Exception("Disconnect failed"))
        mock_connector2 = MagicMock(spec=BaseConnector)
        mock_connector2.disconnect = AsyncMock()

        client.connectors["server1"] = mock_connector1
        client.connectors["server2"] = mock_connector2
        client.active_connectors = ["server1", "server2"]

        # Test close_all_connectors
        await client.close_all_connectors()

        # Verify behavior - even though server1 failed, server2 should still be disconnected
        mock_connector1.disconnect.assert_called_once()
        mock_connector2.disconnect.assert_called_once()

        # Verify state changes
        assert len(client.connectors) == 0
        assert len(client.active_connectors) == 0

    @pytest.mark.asyncio
    @patch("mcp_use.client.create_connector_from_config")
    async def test_create_all_connectors(self, mock_create_connector):
        """Test creating all connectors."""
        config = {
            "mcpServers": {
                "server1": {"url": "http://server1.com"},
                "server2": {"url": "http://server2.com"},
            }
        }
        client = MCPClient(config=config)

        # Set up mocks
        mock_connector1 = MagicMock()
        mock_connector1.initialize = AsyncMock()
        mock_connector2 = MagicMock()
        mock_connector2.initialize = AsyncMock()
        mock_create_connector.side_effect = [mock_connector1, mock_connector2]

        # Test create_all_connectors
        connectors = await client.create_all_connectors()

        # Verify behavior - connectors are created for each server
        assert mock_create_connector.call_count == 2

        # In the implementation, initialize is called twice for each connector:
        # Once in create_connector and once in the explicit initialize call
        assert mock_connector1.initialize.call_count == 2
        assert mock_connector2.initialize.call_count == 2

        # Verify state changes
        assert len(client.connectors) == 2
        assert client.connectors["server1"] == mock_connector1
        assert client.connectors["server2"] == mock_connector2
        assert len(client.active_connectors) == 2
        assert "server1" in client.active_connectors
        assert "server2" in client.active_connectors

        # Verify return value
        assert connectors == client.connectors
