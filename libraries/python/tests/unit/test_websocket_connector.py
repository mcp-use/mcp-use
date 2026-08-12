"""Unit tests for the WebSocket connector."""

from unittest.mock import ANY, AsyncMock, Mock, patch

import pytest
from mcp.types import CallToolResult

from mcp_use.client.connectors.websocket import WebSocketConnector
from mcp_use.client.middleware import CallbackClientSession, Middleware, MiddlewareContext
from mcp_use.client.task_managers import WebSocketConnectionManager


class RecordingMiddleware(Middleware):
    """Record tool calls that pass through the middleware chain."""

    def __init__(self) -> None:
        self.methods: list[str] = []

    async def on_call_tool(self, context: MiddlewareContext, call_next):
        self.methods.append(context.method)
        return await call_next(context)


@pytest.mark.asyncio
@patch("mcp_use.client.connectors.websocket.ClientSession")
@patch("mcp_use.client.connectors.websocket.WebSocketConnectionManager")
async def test_connect_activates_callbacks_and_roots(mock_connection_manager, mock_client_session):
    """WebSocket connections should pass common options into the MCP session."""
    manager = Mock(spec=WebSocketConnectionManager)
    manager.start = AsyncMock(return_value=("read-stream", "write-stream"))
    mock_connection_manager.return_value = manager

    raw_session = Mock()
    raw_session.__aenter__ = AsyncMock()
    mock_client_session.return_value = raw_session

    sampling_callback = AsyncMock()
    elicitation_callback = AsyncMock()
    message_handler = AsyncMock()
    logging_callback = AsyncMock()
    connector = WebSocketConnector(
        "ws://example.com",
        sampling_callback=sampling_callback,
        elicitation_callback=elicitation_callback,
        message_handler=message_handler,
        logging_callback=logging_callback,
    )

    await connector.connect()

    mock_client_session.assert_called_once_with(
        "read-stream",
        "write-stream",
        sampling_callback=sampling_callback,
        elicitation_callback=elicitation_callback,
        list_roots_callback=ANY,
        message_handler=ANY,
        logging_callback=logging_callback,
        client_info=ANY,
    )
    raw_session.__aenter__.assert_awaited_once()
    assert isinstance(connector.client_session, CallbackClientSession)
    assert connector._connected is True


@pytest.mark.asyncio
async def test_tool_calls_run_websocket_middleware():
    """WebSocket tool calls should execute configured middleware."""
    middleware = RecordingMiddleware()
    connector = WebSocketConnector("ws://example.com", middleware=[middleware])
    raw_session = Mock()
    expected = Mock(spec=CallToolResult)
    raw_session.call_tool = AsyncMock(return_value=expected)
    connector.client_session = CallbackClientSession(
        raw_session,
        connector.public_identifier,
        connector.middleware_manager,
    )
    connector._connected = True

    result = await connector.call_tool("example", {"value": 1})

    assert result is expected
    assert middleware.methods == ["tools/call"]
    raw_session.call_tool.assert_awaited_once_with("example", {"value": 1}, None)
