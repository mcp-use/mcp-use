"""
Session manager for MCP connections.

This module provides a session manager for MCP connections,
which handles authentication, initialization, and tool discovery.
"""

from typing import Any

from .connectors.base import BaseConnector


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
