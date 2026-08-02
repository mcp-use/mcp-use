"""
Unit tests for the WebSocketConnector class.
"""

from unittest.mock import patch

import pytest

from mcp_use.client.connectors.websocket import WebSocketConnector


@pytest.fixture(autouse=True)
def mock_logger():
    """Mock the logger to prevent errors during tests."""
    with patch("mcp_use.client.connectors.websocket.logger") as mock_logger:
        yield mock_logger


class TestWebSocketConnectorInitialization:
    """Tests for WebSocketConnector initialization."""

    def test_init_sets_base_connector_attributes(self):
        """Base attributes such as client_session must be initialized, not just the
        WebSocket-specific ones, so inherited BaseConnector methods don't crash with
        AttributeError."""
        connector = WebSocketConnector(url="ws://localhost:8765")

        assert connector.client_session is None
        assert connector._connection_manager is None
        assert connector._tools is None
        assert connector._connected is False

    def test_is_connected_does_not_raise_before_connecting(self):
        """Regression test: accessing is_connected on a freshly constructed
        WebSocketConnector must not raise AttributeError."""
        connector = WebSocketConnector(url="ws://localhost:8765")

        assert connector.is_connected is False

    def test_is_connected_reflects_connected_flag(self):
        """WebSocketConnector doesn't populate client_session (it speaks the MCP
        protocol directly over raw WebSocket messages), so is_connected must be
        derived from its own _connected flag rather than the inherited
        client_session-based check."""
        connector = WebSocketConnector(url="ws://localhost:8765")

        connector._connected = True
        assert connector.client_session is None
        assert connector.is_connected is True

        connector._connected = False
        assert connector.is_connected is False
