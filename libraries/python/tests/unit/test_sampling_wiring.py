"""
Tests to reproduce and verify the fix for issue #863:
Sampling requests fail with 'MCP error -32600: Sampling not supported'

The root cause: create_connector_from_config passes auth=server_config.get("auth", {})
which defaults to an empty dict instead of None. For WebSocket connectors, callbacks
are silently dropped entirely.
"""

from unittest.mock import AsyncMock, Mock, patch

import pytest
from mcp.types import CreateMessageRequestParams, CreateMessageResult, ErrorData, TextContent

from mcp_use.client.config import create_connector_from_config
from mcp_use.client.connectors.http import HttpConnector
from mcp_use.client.connectors.stdio import StdioConnector
from mcp_use.client.connectors.websocket import WebSocketConnector


async def sampling_callback(context, params: CreateMessageRequestParams) -> CreateMessageResult | ErrorData:
    """A valid sampling callback that returns a result."""
    return CreateMessageResult(
        content=TextContent(text="sampled response", type="text"),
        model="test-model",
        role="assistant",
    )


class TestSamplingCallbackWiring:
    """Reproduce issue #863: verify sampling_callback is properly wired through config factory."""

    def test_http_connector_receives_sampling_callback(self):
        """Sampling callback should be passed to HttpConnector via config factory."""
        server_config = {"url": "http://localhost:8080/mcp"}
        connector = create_connector_from_config(
            server_config,
            sampling_callback=sampling_callback,
        )
        assert isinstance(connector, HttpConnector)
        assert connector.sampling_callback is sampling_callback

    def test_stdio_connector_receives_sampling_callback(self):
        """Sampling callback should be passed to StdioConnector via config factory."""
        server_config = {"command": "echo", "args": ["hello"]}
        connector = create_connector_from_config(
            server_config,
            sampling_callback=sampling_callback,
        )
        assert isinstance(connector, StdioConnector)
        assert connector.sampling_callback is sampling_callback

    def test_websocket_connector_receives_sampling_callback(self):
        """Sampling callback should be passed to WebSocketConnector via config factory.

        This is the core reproduction of issue #863: WebSocketConnector silently
        drops the sampling_callback, causing 'Sampling not supported' errors.
        """
        server_config = {"ws_url": "ws://localhost:8080"}
        connector = create_connector_from_config(
            server_config,
            sampling_callback=sampling_callback,
        )
        assert isinstance(connector, WebSocketConnector)
        assert connector.sampling_callback is sampling_callback

    def test_http_connector_no_unnecessary_oauth_setup(self):
        """When no auth is configured, HttpConnector should not set up OAuth.

        create_connector_from_config passes auth=server_config.get("auth", {})
        which gives an empty dict instead of None, triggering unnecessary OAuth setup.
        """
        server_config = {"url": "http://localhost:8080/mcp"}
        connector = create_connector_from_config(server_config)
        assert isinstance(connector, HttpConnector)
        assert connector._oauth is None, (
            "HttpConnector should not have OAuth configured when no auth is in server config. "
            "create_connector_from_config passes auth={} instead of auth=None."
        )

    @pytest.mark.asyncio
    @patch("mcp_use.client.connectors.stdio.StdioConnectionManager")
    @patch("mcp_use.client.connectors.stdio.ClientSession")
    async def test_sampling_callback_reaches_client_session(self, mock_client_session, mock_connection_manager):
        """End-to-end: sampling_callback from config factory reaches the MCP SDK ClientSession.

        This verifies the full chain: config -> connector -> ClientSession.
        """
        mock_manager_instance = Mock()
        mock_manager_instance.start = AsyncMock(return_value=("read_stream", "write_stream"))
        mock_connection_manager.return_value = mock_manager_instance

        mock_client_instance = Mock()
        mock_client_instance.__aenter__ = AsyncMock()
        mock_client_session.return_value = mock_client_instance

        server_config = {"command": "echo", "args": ["hello"]}
        connector = create_connector_from_config(
            server_config,
            sampling_callback=sampling_callback,
        )
        await connector.connect()

        call_kwargs = mock_client_session.call_args.kwargs
        assert call_kwargs.get("sampling_callback") is sampling_callback, (
            "sampling_callback was not passed to ClientSession. "
            "This causes 'MCP error -32600: Sampling not supported'."
        )
