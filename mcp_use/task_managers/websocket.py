"""
WebSocket connection management for MCP implementations.

This module provides a connection manager for WebSocket-based MCP connections.
"""

from typing import Any

from mcp.client.websocket import websocket_client

from ..logging import logger
from .base import ConnectionManager


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

    async def _establish_connection(self) -> tuple[Any, Any]:
        """Establish a WebSocket connection.

        Returns:
            The established WebSocket connection

        Raises:
            Exception: If connection cannot be established
        """
        logger.debug(f"Connecting to WebSocket: {self.url}")
        # Create the context manager
        # Note: The current MCP websocket_client implementation doesn't support headers
        # If headers need to be passed, this would need to be updated when MCP supports it
        self._ws_ctx = websocket_client(self.url)

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
