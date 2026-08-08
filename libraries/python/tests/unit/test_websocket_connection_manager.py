#!/usr/bin/env python3
"""Unit tests for WebSocketConnectionManager."""

import pytest

from mcp_use.client.task_managers import websocket as websocket_module
from mcp_use.task_managers.websocket import WebSocketConnectionManager


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

    def test_headers_raise_clear_error_when_websocket_client_does_not_support_them(self):
        """Configured headers should not be silently ignored by websocket_client."""
        manager = WebSocketConnectionManager("ws://example.com", {"Authorization": "Bearer test-token"})

        with pytest.raises(RuntimeError, match="does not support forwarding handshake headers"):
            manager._websocket_client_kwargs()

    def test_headers_are_forwarded_when_websocket_client_supports_them(self, monkeypatch):
        """Headers should be forwarded when the underlying MCP client supports them."""

        def websocket_client_with_headers(url, headers=None):
            return None

        monkeypatch.setattr(websocket_module, "websocket_client", websocket_client_with_headers)

        headers = {"Authorization": "Bearer test-token"}
        manager = WebSocketConnectionManager("ws://example.com", headers)

        assert manager._websocket_client_kwargs() == {"headers": headers}

    async def test_establish_connection_forwards_headers_to_websocket_client(self, monkeypatch):
        """Regression test for Authorization/header propagation during handshake setup."""
        calls = []

        class WebSocketClientContext:
            async def __aenter__(self):
                return ("read-stream", "write-stream")

            async def __aexit__(self, exc_type, exc_value, traceback):
                return None

        def websocket_client_with_headers(url, headers=None):
            calls.append({"url": url, "headers": headers})
            return WebSocketClientContext()

        monkeypatch.setattr(websocket_module, "websocket_client", websocket_client_with_headers)

        headers = {"Authorization": "Bearer test-token"}
        manager = WebSocketConnectionManager("ws://example.com", headers)

        assert await manager._establish_connection() == ("read-stream", "write-stream")
        assert calls == [{"url": "ws://example.com", "headers": headers}]
