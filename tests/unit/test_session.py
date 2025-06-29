"""
Unit tests for the MCPSession class.
"""

import unittest
from unittest import IsolatedAsyncioTestCase
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

from mcp_use.session import MCPSession


class TestMCPSessionInitialization(unittest.TestCase):
    """Tests for MCPSession initialization."""

    def test_init_default(self):
        """Test initialization with default parameters."""
        connector = MagicMock()
        session = MCPSession(connector)

        self.assertEqual(session.connector, connector)
        self.assertIsNone(session.session_info)
        self.assertTrue(session.auto_connect)

    def test_init_with_auto_connect_false(self):
        """Test initialization with auto_connect set to False."""
        connector = MagicMock()
        session = MCPSession(connector, auto_connect=False)

        self.assertEqual(session.connector, connector)
        self.assertIsNone(session.session_info)
        self.assertFalse(session.auto_connect)


class TestMCPSessionConnection(IsolatedAsyncioTestCase):
    """Tests for MCPSession connection methods."""

    def setUp(self):
        """Set up a session with a mock connector for each test."""
        self.connector = MagicMock()
        self.connector.connect = AsyncMock()
        self.connector.disconnect = AsyncMock()

        # Mock the is_connected property - by default not connected
        type(self.connector).is_connected = PropertyMock(return_value=False)

        self.session = MCPSession(self.connector)

    async def test_connect(self):
        """Test connecting to the MCP implementation."""
        await self.session.connect()
        self.connector.connect.assert_called_once()

    async def test_disconnect(self):
        """Test disconnecting from the MCP implementation."""
        await self.session.disconnect()
        self.connector.disconnect.assert_called_once()

    async def test_async_context_manager(self):
        """Test using the session as an async context manager."""
        async with self.session as session:
            self.assertEqual(session, self.session)
            self.connector.connect.assert_called_once()

        self.connector.disconnect.assert_called_once()

    async def test_is_connected_property(self):
        """Test the is_connected property."""
        # Test when not connected
        self.assertFalse(self.session.is_connected)

        # Test when connected - update the mock to return True
        type(self.connector).is_connected = PropertyMock(return_value=True)
        self.assertTrue(self.session.is_connected)


class TestMCPSessionOperations(IsolatedAsyncioTestCase):
    """Tests for MCPSession operations."""

    def setUp(self):
        """Set up a session with a mock connector for each test."""
        self.connector = MagicMock()
        self.connector.connect = AsyncMock()
        self.connector.disconnect = AsyncMock()
        self.connector.initialize = AsyncMock(return_value={"session_id": "test_session"})

        # Mock the is_connected property - by default not connected
        type(self.connector).is_connected = PropertyMock(return_value=False)

        self.session = MCPSession(self.connector)

    async def test_initialize(self):
        """Test initializing the session."""
        # Test initialization when not connected
        result = await self.session.initialize()

        # Verify connect was called since auto_connect is True
        self.connector.connect.assert_called_once()
        self.connector.initialize.assert_called_once()

        # Verify session_info was set
        self.assertEqual(self.session.session_info, {"session_id": "test_session"})
        self.assertEqual(result, {"session_id": "test_session"})

    async def test_initialize_already_connected(self):
        """Test initializing the session when already connected."""
        # Set up the connector to indicate it's already connected
        type(self.connector).is_connected = PropertyMock(return_value=True)

        # Test initialization when already connected
        await self.session.initialize()

        # Verify connect was not called since already connected
        self.connector.connect.assert_not_called()
        self.connector.initialize.assert_called_once()
