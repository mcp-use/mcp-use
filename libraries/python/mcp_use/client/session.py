"""
Session manager for MCP connections.

This module provides a session manager for MCP connections,
which handles authentication, initialization, and tool discovery.
"""

from datetime import timedelta
from typing import Any

from mcp.types import CallToolResult, GetPromptResult, Prompt, ReadResourceResult, Resource, Tool
from pydantic import AnyUrl

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

    # Convenience methods for MCP operations
    async def call_tool(
        self, name: str, arguments: dict[str, Any], read_timeout_seconds: timedelta | None = None
    ) -> CallToolResult:
        """Call an MCP tool.

        Args:
            name: The name of the tool to call.
            arguments: The arguments to pass to the tool.
            read_timeout_seconds: Optional timeout for the tool call.

        Returns:
            The result of the tool call.

        Raises:
            RuntimeError: If the connection is lost and cannot be reestablished.
        """
        return await self.connector.call_tool(name, arguments, read_timeout_seconds)

    async def list_tools(self) -> list[Tool]:
        """List all available tools from the MCP server.

        Returns:
            List of available tools.
        """
        return await self.connector.list_tools()

    async def list_resources(self) -> list[Resource]:
        """List all available resources from the MCP server.

        Returns:
            List of available resources.
        """
        return await self.connector.list_resources()

    async def read_resource(self, uri: AnyUrl) -> ReadResourceResult:
        """Read a resource by URI.

        Args:
            uri: The URI of the resource to read.

        Returns:
            The resource content.
        """
        return await self.connector.read_resource(uri)

    async def list_prompts(self) -> list[Prompt]:
        """List all available prompts from the MCP server.

        Returns:
            List of available prompts.
        """
        return await self.connector.list_prompts()

    async def get_prompt(self, name: str, arguments: dict[str, Any] | None = None) -> GetPromptResult:
        """Get a prompt by name.

        Args:
            name: The name of the prompt to get.
            arguments: Optional arguments for the prompt.

        Returns:
            The prompt result with messages.
        """
        return await self.connector.get_prompt(name, arguments)
