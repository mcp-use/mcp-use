"""Unit tests for the WebSocket connector."""

from typing import Any

import pytest

from mcp_use.client.connectors.websocket import WebSocketConnector


@pytest.mark.asyncio
async def test_tools_property_allows_initialized_empty_tool_list():
    """An initialized connector may legitimately expose zero tools."""
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
