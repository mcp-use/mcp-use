#!/usr/bin/env python3
"""Unit tests for WebSocketConnectionManager."""

import pytest

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
