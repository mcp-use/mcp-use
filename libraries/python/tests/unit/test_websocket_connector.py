"""
Unit tests for the WebSocketConnector class.
"""

from unittest.mock import MagicMock, patch

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

    def test_is_connected_reflects_connected_flag_with_running_receiver(self):
        """WebSocketConnector doesn't populate client_session (it speaks the MCP
        protocol directly over raw WebSocket messages), so is_connected must be
        derived from its own _connected flag rather than the inherited
        client_session-based check."""
        connector = WebSocketConnector(url="ws://localhost:8765")
        connector._connected = True
        connector._receiver_task = MagicMock()
        connector._receiver_task.done.return_value = False

        assert connector.client_session is None
        assert connector.is_connected is True

        connector._connected = False
        assert connector.is_connected is False

    def test_is_connected_false_without_receiver_task(self):
        """_connected=True alone must not be enough; a receiver task must
        actually be running for the connection to be considered live."""
        connector = WebSocketConnector(url="ws://localhost:8765")
        connector._connected = True
        connector._receiver_task = None

        assert connector.is_connected is False

    def test_is_connected_false_after_receiver_task_dies(self):
        """Regression test: _receive_messages catches its own exceptions
        internally and returns without resetting _connected, so a dropped
        connection must be detected via the receiver task having finished
        rather than via _connected alone."""
        connector = WebSocketConnector(url="ws://localhost:8765")
        connector._connected = True
        connector._receiver_task = MagicMock()
        connector._receiver_task.done.return_value = True

        assert connector.is_connected is False
