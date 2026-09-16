"""Request lifecycle regressions for the WebSocket connector."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from mcp_use.client.connectors.websocket import WebSocketConnector


@pytest.fixture
def connector():
    connector = WebSocketConnector("ws://example.test/mcp")
    connector.ws = MagicMock()
    connector.ws.send = AsyncMock()
    return connector


@pytest.mark.asyncio
@pytest.mark.parametrize("during_send", [False, True])
async def test_cancelled_request_is_removed(connector, during_send):
    """Cancellation releases pending state, including while sending the request."""
    sent = asyncio.Event()

    async def send(message):
        sent.set()
        if during_send:
            await asyncio.Future()

    connector.ws.send.side_effect = send
    request = asyncio.create_task(connector.call_tool("slow_tool", {}))
    await asyncio.wait_for(sent.wait(), timeout=1)
    request.cancel()

    with pytest.raises(asyncio.CancelledError):
        await request

    assert connector.pending_requests == {}


@pytest.mark.asyncio
async def test_failed_send_is_removed(connector):
    """A transport failure must not retain a request that cannot receive a reply."""
    connector.ws.send.side_effect = ConnectionError("connection closed")

    with pytest.raises(ConnectionError, match="connection closed"):
        await connector.request("tools/list")

    assert connector.pending_requests == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("late_response", [{"result": {}}, {"error": {"message": "late error"}}])
async def test_late_cancelled_response_does_not_fail_other_requests(connector, late_response):
    """A reply racing with cancellation must not stop the shared receiver."""
    sent = asyncio.Queue()

    async def send(message):
        sent.put_nowait(json.loads(message))

    connector.ws.send.side_effect = send
    cancelled = asyncio.create_task(connector.request("cancelled"))
    live = asyncio.create_task(connector.request("live"))
    try:
        first = await asyncio.wait_for(sent.get(), timeout=1)
        second = await asyncio.wait_for(sent.get(), timeout=1)
        cancelled.cancel()

        # Deliver the late reply before the cancelled request resumes its cleanup.
        connector.ws.__aiter__.return_value = [
            json.dumps({"id": first["id"], **late_response}),
            json.dumps({"id": second["id"], "result": {"value": "ok"}}),
        ]
        await connector._receive_messages()

        assert await asyncio.wait_for(live, timeout=1) == {"value": "ok"}
        with pytest.raises(asyncio.CancelledError):
            await cancelled
        assert connector.pending_requests == {}
    finally:
        cancelled.cancel()
        live.cancel()
        await asyncio.gather(cancelled, live, return_exceptions=True)
