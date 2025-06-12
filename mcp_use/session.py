"""
Session manager for MCP connections.

This module provides a session manager for MCP connections,
which handles authentication, initialization, and tool discovery.
"""

from typing import Any

from .connectors.base import BaseConnector
from .logging import logger


class MCPSession:
    """Session manager for MCP connections.

    This class manages the lifecycle of an MCP connection, including
    authentication, initialization, and tool discovery.
    """

    def __init__(
        self,
        connector: BaseConnector,
        auto_connect: bool = True,
    ) -> None:
        """Initialize a new MCP session.

        Args:
            connector: The connector to use for communicating with the MCP implementation.
            auto_connect: Whether to automatically connect to the MCP implementation.
        """
        self.connector = connector
        self.session_info: dict[str, Any] | None = None
        self.auto_connect = auto_connect

    async def __aenter__(self) -> "MCPSession":
        """Enter the async context manager.

        Returns:
            The session instance.
        """
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Exit the async context manager.

        Args:
            exc_type: The exception type, if an exception was raised.
            exc_val: The exception value, if an exception was raised.
            exc_tb: The exception traceback, if an exception was raised.
        """
        await self.disconnect()

    async def connect(self) -> None:
        """Connect to the MCP implementation."""
        await self.connector.connect()

    async def disconnect(self) -> None:
        """Disconnect from the MCP implementation."""
        await self.connector.disconnect()

    async def initialize(self) -> dict[str, Any]:
        """Initialize the MCP session and discover available tools.

        Returns:
            The session information returned by the MCP implementation.
        """
        # Make sure we're connected
        if not self.is_connected and self.auto_connect:
            await self.connect()

        # Initialize the session
        self.session_info = await self.connector.initialize()

        return self.session_info

    @property
    def is_connected(self) -> bool:
        """Check if the connector is connected.

        Returns:
            True if the connector is connected, False otherwise.
        """
        return self.connector.is_connected

    async def _ensure_connected(self) -> None:
        """Ensure the session is connected, reconnecting if necessary.

        Raises:
            RuntimeError: If connection cannot be established and auto_connect is False.
        """
        if not self.is_connected:
            if self.auto_connect:
                logger.debug("Connection lost, attempting to reconnect...")
                try:
                    await self.connect()
                    logger.debug("Reconnection successful")
                except Exception as e:
                    raise RuntimeError(f"Failed to reconnect to MCP server: {e}") from e
            else:
                raise RuntimeError("Connection to MCP server has been lost. " "Auto-reconnection is disabled. Please reconnect manually.")

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        """Call a tool with automatic reconnection handling.

        Args:
            name: The name of the tool to call.
            arguments: The arguments to pass to the tool.

        Returns:
            The result of the tool call.

        Raises:
            RuntimeError: If the connection is lost and cannot be reestablished.
        """
        # Ensure we're connected before calling the tool
        await self._ensure_connected()

        try:
            return await self.connector.call_tool(name, arguments)
        except Exception as e:
            # Check if the error might be due to connection loss
            if not self.is_connected:
                logger.debug(f"Tool call failed, connection lost: {e}")
                # Try to reconnect and retry once
                await self._ensure_connected()
                try:
                    return await self.connector.call_tool(name, arguments)
                except Exception as retry_error:
                    raise RuntimeError(f"Tool call '{name}' failed after reconnection: {retry_error}") from retry_error
            else:
                # Re-raise the original error if it's not connection-related
                raise
