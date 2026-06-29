"""
Unit tests for the WebSocketConnector class.

Regression coverage for the ``call_tool`` signature mismatch: ``MCPSession``
forwards ``read_timeout_seconds`` as a third positional argument, so the
connector must accept it like every other connector and ``BaseConnector``.
"""

import asyncio
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest

from mcp_use.client.connectors.websocket import WebSocketConnector


@pytest.fixture(autouse=True)
def mock_logger():
    """Mock the logger to prevent errors during tests."""
    with patch("mcp_use.client.connectors.websocket.logger") as mock_logger:
        yield mock_logger


async def test_call_tool_accepts_read_timeout_seconds_positionally():
    """call_tool must accept read_timeout_seconds the way MCPSession passes it.

    MCPSession.call_tool does ``connector.call_tool(name, arguments, read_timeout_seconds)``,
    so a connector whose signature is ``call_tool(self, name, arguments)`` raises
    ``TypeError: ... takes 3 positional arguments but 4 were given``.
    """
    connector = WebSocketConnector(url="ws://localhost:8000")
    connector._send_request = AsyncMock(return_value={"ok": True})

    timeout = timedelta(seconds=5)
    result = await connector.call_tool("my_tool", {"x": 1}, timeout)

    assert result == {"ok": True}
    connector._send_request.assert_awaited_once_with(
        "tools/call",
        {"name": "my_tool", "arguments": {"x": 1}},
        read_timeout_seconds=timeout,
    )


async def test_call_tool_without_timeout_resolves_result():
    """Default (no timeout) path returns the response result."""
    connector = WebSocketConnector(url="ws://localhost:8000")
    connector.ws = AsyncMock()

    async def resolve_pending():
        for _ in range(200):
            if connector.pending_requests:
                request_id = next(iter(connector.pending_requests))
                connector.pending_requests[request_id].set_result({"content": "done"})
                return
            await asyncio.sleep(0.001)

    resolver = asyncio.create_task(resolve_pending())
    result = await connector.call_tool("t", {})
    await resolver

    assert result == {"content": "done"}


async def test_call_tool_honors_timeout_and_cleans_up():
    """When read_timeout_seconds elapses with no response, raise and drop the request."""
    connector = WebSocketConnector(url="ws://localhost:8000")
    connector.ws = AsyncMock()  # send() is awaited; the future is never resolved

    with pytest.raises(asyncio.TimeoutError):
        await connector.call_tool("t", {}, timedelta(seconds=0.01))

    assert connector.pending_requests == {}
