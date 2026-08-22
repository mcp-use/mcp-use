"""Unit tests for the WebSocketConnector class."""

from typing import Any

import pytest

from mcp_use.client.connectors.websocket import WebSocketConnector


class TestWebSocketConnectorToolsProperty:
    """Tests for WebSocketConnector.tools property initialization semantics."""

    def test_tools_property_not_initialized(self):
        """Uninitialized connectors should still raise RuntimeError."""
        connector = WebSocketConnector("ws://localhost:8080")
        connector._tools = None

        with pytest.raises(RuntimeError, match="MCP client is not initialized"):
            _ = connector.tools

    @pytest.mark.asyncio
    async def test_tools_property_allows_initialized_empty_tool_list(self):
        """An initialized empty tools list is valid and must not raise."""
        connector = WebSocketConnector("ws://localhost:8080")

        async def fake_send_request(method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
            if method == "initialize":
                return {}
            if method == "tools/list":
                return {"tools": []}
            raise AssertionError(f"unexpected method: {method}")

        connector._send_request = fake_send_request

        await connector.initialize()

        assert connector.tools == []
