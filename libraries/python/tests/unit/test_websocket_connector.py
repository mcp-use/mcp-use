import asyncio
from datetime import timedelta
from unittest.mock import AsyncMock

import pytest

from mcp_use.client.connectors.websocket import WebSocketConnector


@pytest.mark.asyncio
async def test_call_tool_respects_read_timeout_seconds():
    connector = WebSocketConnector("ws://localhost:8080")
    connector.ws = AsyncMock()

    with pytest.raises(asyncio.TimeoutError):
        await connector.call_tool(
            "slow_tool",
            {"value": 1},
            read_timeout_seconds=timedelta(milliseconds=10),
        )

    assert connector.pending_requests == {}
