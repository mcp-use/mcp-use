"""
WebSocket connection management for MCP implementations.

This module provides a connection manager for WebSocket-based MCP connections.
"""

from inspect import signature
from typing import Any

from mcp.client.websocket import websocket_client

from mcp_use.client.task_managers.base import ConnectionManager
from mcp_use.logging import logger


class WebSocketConnectionManager(ConnectionManager[tuple[Any, Any]]):
    """Connection manager for WebSocket-based MCP connections.

    This class handles the lifecycle of WebSocket connections, ensuring proper
    connection establishment and cleanup.
    """

    def __init__(
        self,
        url: str,
        headers: dict[str, str] | None = None,
    ):
        """Initialize a new WebSocket connection manager.

        Args:
            url: The WebSocket URL to connect to
            headers: Optional HTTP headers
        """
        super().__init__()
        self.url = url
        self.headers = headers or {}

    def _websocket_client_kwargs(self) -> dict[str, dict[str, str]]:
        """Return supported keyword arguments for websocket_client."""
        if not self.headers:
            return {}

        parameters = signature(websocket_client).parameters
        for headers_parameter in ("headers", "extra_headers", "additional_headers"):
            if headers_parameter in parameters:
                return {headers_parameter: self.headers}

        raise RuntimeError(
            "WebSocket headers/auth were configured, but the installed MCP "
            "websocket_client does not support forwarding handshake headers. "
            "Upgrade the mcp package to a version that supports websocket "
            "headers or remove the websocket headers/auth configuration."
        )

    async def _establish_connection(self) -> tuple[Any, Any]:
        """Establish a WebSocket connection.

        Returns:
            The established WebSocket connection

        Raises:
            Exception: If connection cannot be established
        """
        logger.debug(f"Connecting to WebSocket: {self.url}")
        # Create the context manager
        self._ws_ctx = websocket_client(self.url, **self._websocket_client_kwargs())

        # Enter the context manager
        read_stream, write_stream = await self._ws_ctx.__aenter__()

        # Return the streams
        return (read_stream, write_stream)

    async def _close_connection(self) -> None:
        """Close the WebSocket connection."""
        if self._ws_ctx:
            # Exit the context manager
            try:
                logger.debug("Closing WebSocket connection")
                await self._ws_ctx.__aexit__(None, None, None)
            except Exception as e:
                logger.warning(f"Error closing WebSocket connection: {e}")
            finally:
                self._ws_ctx = None
