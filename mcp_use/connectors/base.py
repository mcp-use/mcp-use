"""
Base connector for MCP implementations.

This module provides the base connector interface that all MCP connectors
must implement.
"""

import warnings
from abc import ABC, abstractmethod
from datetime import timedelta
from typing import Any

from mcp import ClientSession, Implementation
from mcp.client.session import ElicitationFnT, LoggingFnT, MessageHandlerFnT, SamplingFnT
from mcp.shared.exceptions import McpError
from mcp.types import (
    CallToolResult,
    GetPromptResult,
    Prompt,
    PromptListChangedNotification,
    ReadResourceResult,
    Resource,
    ResourceListChangedNotification,
    ServerCapabilities,
    ServerNotification,
    Tool,
    ToolListChangedNotification,
)
from pydantic import AnyUrl

import mcp_use

from ..logging import logger
from ..task_managers import ConnectionManager


class BaseConnector(ABC):
    """Base class for MCP connectors.

    This class defines the interface that all MCP connectors must implement.
    """

    def __init__(
        self,
        sampling_callback: SamplingFnT | None = None,
        elicitation_callback: ElicitationFnT | None = None,
        message_handler: MessageHandlerFnT | None = None,
        logging_callback: LoggingFnT | None = None,
    ):
        """Initialize base connector with common attributes."""
        self.client_session: ClientSession | None = None
        self._connection_manager: ConnectionManager | None = None
        self._tools: list[Tool] | None = None
        self._resources: list[Resource] | None = None
        self._prompts: list[Prompt] | None = None
        self._connected = False
        self._initialized = False  # Track if client_session.initialize() has been called
        self.auto_reconnect = True  # Whether to automatically reconnect on connection loss (not configurable for now)
        self.sampling_callback = sampling_callback
        self.elicitation_callback = elicitation_callback
        self.message_handler = message_handler
        self.logging_callback = logging_callback
        self.capabilities: ServerCapabilities | None = None

    @property
    def client_info(self) -> Implementation:
        """Get the client info for the connector."""
        return Implementation(
            name="mcp-use",
            version=mcp_use.__version__,
            url="https://github.com/mcp-use/mcp-use",
        )

    async def _internal_message_handler(self, message: Any) -> None:
        """Wrap the user-provided message handler."""
        if isinstance(message, ServerNotification):
            if isinstance(message.root, ToolListChangedNotification):
                logger.debug("Received tool list changed notification")
            elif isinstance(message.root, ResourceListChangedNotification):
                logger.debug("Received resource list changed notification")
            elif isinstance(message.root, PromptListChangedNotification):
                logger.debug("Received prompt list changed notification")

        # Call the user's handler
        if self.message_handler:
            await self.message_handler(message)

    @abstractmethod
    async def connect(self) -> None:
        """Establish a connection to the MCP implementation."""
        pass

    @property
    @abstractmethod
    def public_identifier(self) -> str:
        """Get the identifier for the connector."""
        pass

    async def disconnect(self) -> None:
        """Close the connection to the MCP implementation."""
        if not self._connected:
            logger.debug("Not connected to MCP implementation")
            return

        logger.debug("Disconnecting from MCP implementation")
        await self._cleanup_resources()
        self._connected = False
        logger.debug("Disconnected from MCP implementation")

    async def _cleanup_resources(self) -> None:
        """Clean up all resources associated with this connector."""
        errors = []

        # First close the client session
        if self.client_session:
            try:
                logger.debug("Closing client session")
                await self.client_session.__aexit__(None, None, None)
            except Exception as e:
                error_msg = f"Error closing client session: {e}"
                logger.warning(error_msg)
                errors.append(error_msg)
            finally:
                self.client_session = None

        # Then stop the connection manager
        if self._connection_manager:
            try:
                logger.debug("Stopping connection manager")
                await self._connection_manager.stop()
            except Exception as e:
                error_msg = f"Error stopping connection manager: {e}"
                logger.warning(error_msg)
                errors.append(error_msg)
            finally:
                self._connection_manager = None

        # Reset tools
        self._tools = None
        self._resources = None
        self._prompts = None
        self._initialized = False  # Reset initialization flag

        if errors:
            logger.warning(f"Encountered {len(errors)} errors during resource cleanup")

    async def initialize(self) -> dict[str, Any]:
        """Initialize the MCP session and return session information."""
        if not self.client_session:
            raise RuntimeError("MCP client is not connected")

        # Check if already initialized
        if self._initialized:
            return {"status": "already_initialized"}

        # Initialize the session
        result = await self.client_session.initialize()
        self._initialized = True  # Mark as initialized

        self.capabilities = result.capabilities

        if self.capabilities.tools:
            # Get available tools directly from client session
            try:
                tools_result = await self.client_session.list_tools()
                self._tools = tools_result.tools if tools_result else []
            except Exception as e:
                logger.error(f"Error listing tools for connector {self.public_identifier}: {e}")
                self._tools = []
        else:
            self._tools = []

        if self.capabilities.resources:
            # Get available resources directly from client session
            try:
                resources_result = await self.client_session.list_resources()
                self._resources = resources_result.resources if resources_result else []
            except Exception as e:
                logger.error(f"Error listing resources for connector {self.public_identifier}: {e}")
                self._resources = []
        else:
            self._resources = []

        if self.capabilities.prompts:
            # Get available prompts directly from client session
            try:
                prompts_result = await self.client_session.list_prompts()
                self._prompts = prompts_result.prompts if prompts_result else []
            except Exception as e:
                logger.error(f"Error listing prompts for connector {self.public_identifier}: {e}")
                self._prompts = []
        else:
            self._prompts = []

        logger.debug(
            f"MCP session initialized with {len(self._tools)} tools, "
            f"{len(self._resources)} resources, "
            f"and {len(self._prompts)} prompts"
        )

        return result

    @property
    def tools(self) -> list[Tool]:
        """Get the list of available tools.

        .. deprecated::
            This property is deprecated because it may return stale data when the server
            sends list change notifications. Use `await list_tools()` instead to ensure
            you always get the latest data.
        """
        warnings.warn(
            "The 'tools' property is deprecated and may return stale data. "
            "Use 'await list_tools()' instead to ensure fresh data.",
            DeprecationWarning,
            stacklevel=2,
        )
        if self._tools is None:
            raise RuntimeError("MCP client is not initialized")
        return self._tools

    @property
    def resources(self) -> list[Resource]:
        """Get the list of available resources.

        .. deprecated::
            This property is deprecated because it may return stale data when the server
            sends list change notifications. Use `await list_resources()` instead to ensure
            you always get the latest data.
        """
        warnings.warn(
            "The 'resources' property is deprecated and may return stale data. "
            "Use 'await list_resources()' instead to ensure fresh data.",
            DeprecationWarning,
            stacklevel=2,
        )
        if self._resources is None:
            raise RuntimeError("MCP client is not initialized")
        return self._resources

    @property
    def prompts(self) -> list[Prompt]:
        """Get the list of available prompts.

        .. deprecated::
            This property is deprecated because it may return stale data when the server
            sends list change notifications. Use `await list_prompts()' instead to ensure
            you always get the latest data.
        """
        warnings.warn(
            "The 'prompts' property is deprecated and may return stale data. "
            "Use 'await list_prompts()' instead to ensure fresh data.",
            DeprecationWarning,
            stacklevel=2,
        )
        if self._prompts is None:
            raise RuntimeError("MCP client is not initialized")
        return self._prompts

    @property
    def is_connected(self) -> bool:
        """Check if the connector is actually connected and the connection is alive.

        This property checks not only the connected flag but also verifies that
        the underlying connection manager and streams are still active.

        Returns:
            True if the connector is connected and the connection is alive, False otherwise.
        """

        # Check if we have a client session
        if not self.client_session:
            # Update the connected flag since we don't have a client session
            self._connected = False
            return False

        # First check the basic connected flag
        if not self._connected:
            return False

        # Check if we have a connection manager and if its task is still running
        if self._connection_manager:
            try:
                # Check if the connection manager task is done (indicates disconnection)
                if hasattr(self._connection_manager, "_task") and self._connection_manager._task:
                    if self._connection_manager._task.done():
                        logger.debug("Connection manager task is done, marking as disconnected")
                        self._connected = False
                        return False

                # For HTTP-based connectors, also check if streams are still open
                # Use the get_streams method to get the current connection
                streams = self._connection_manager.get_streams()
                if streams:
                    # Connection should be a tuple of (read_stream, write_stream)
                    if isinstance(streams, tuple) and len(streams) == 2:
                        read_stream, write_stream = streams
                        # Check if streams are closed using getattr with default value
                        if getattr(read_stream, "_closed", False):
                            logger.debug("Read stream is closed, marking as disconnected")
                            self._connected = False
                            return False
                        if getattr(write_stream, "_closed", False):
                            logger.debug("Write stream is closed, marking as disconnected")
                            self._connected = False
                            return False

            except Exception as e:
                # If we can't check the connection state, assume disconnected for safety
                logger.debug(f"Error checking connection state: {e}, marking as disconnected")
                self._connected = False
                return False

        return True

    async def _ensure_connected(self) -> None:
        """Ensure the connector is connected, reconnecting if necessary.

        Raises:
            RuntimeError: If connection cannot be established and auto_reconnect is False.
        """
        if not self.client_session:
            raise RuntimeError("MCP client is not connected")

        if not self.is_connected:
            if self.auto_reconnect:
                logger.debug("Connection lost, attempting to reconnect...")
                try:
                    await self.connect()
                    logger.debug("Reconnection successful")
                except Exception as e:
                    raise RuntimeError(f"Failed to reconnect to MCP server: {e}") from e
            else:
                raise RuntimeError(
                    "Connection to MCP server has been lost. Auto-reconnection is disabled. Please reconnect manually."
                )

    async def call_tool(
        self, name: str, arguments: dict[str, Any], read_timeout_seconds: timedelta | None = None
    ) -> CallToolResult:
        """Call an MCP tool with automatic reconnection handling.

        Args:
            name: The name of the tool to call.
            arguments: The arguments to pass to the tool.
            read_timeout_seconds: timeout seconds when calling tool

        Returns:
            The result of the tool call.

        Raises:
            RuntimeError: If the connection is lost and cannot be reestablished.
        """

        # Ensure we're connected
        await self._ensure_connected()

        logger.debug(f"Calling tool '{name}' with arguments: {arguments}")
        try:
            result = await self.client_session.call_tool(name, arguments, read_timeout_seconds)
            logger.debug(f"Tool '{name}' called with result: {result}")
            return result
        except Exception as e:
            # Check if the error might be due to connection loss
            if not self.is_connected:
                raise RuntimeError(f"Tool call '{name}' failed due to connection loss: {e}") from e
            else:
                # Re-raise the original error if it's not connection-related
                raise

    async def list_tools(self) -> list[Tool]:
        """List all available tools from the MCP implementation."""

        if self.capabilities and not self.capabilities.tools:
            logger.debug(f"Server {self.public_identifier} does not support tools")
            return []

        # Ensure we're connected
        await self._ensure_connected()

        logger.debug("Listing tools")
        try:
            result = await self.client_session.list_tools()
            self._tools = result.tools
            return result.tools
        except McpError as e:
            logger.error(f"Error listing tools for connector {self.public_identifier}: {e}")
            return []

    async def list_resources(self) -> list[Resource]:
        """List all available resources from the MCP implementation."""

        if self.capabilities and not self.capabilities.resources:
            logger.debug(f"Server {self.public_identifier} does not support resources")
            return []

        # Ensure we're connected
        await self._ensure_connected()

        logger.debug("Listing resources")
        try:
            result = await self.client_session.list_resources()
            self._resources = result.resources
            return result.resources
        except McpError as e:
            logger.warning(f"Error listing resources for connector {self.public_identifier}: {e}")
            return []

    async def read_resource(self, uri: AnyUrl) -> ReadResourceResult:
        """Read a resource by URI."""
        await self._ensure_connected()

        logger.debug(f"Reading resource: {uri}")
        result = await self.client_session.read_resource(uri)
        return result

    async def list_prompts(self) -> list[Prompt]:
        """List all available prompts from the MCP implementation."""

        if self.capabilities and not self.capabilities.prompts:
            logger.debug(f"Server {self.public_identifier} does not support prompts")
            return []

        await self._ensure_connected()

        logger.debug("Listing prompts")
        try:
            result = await self.client_session.list_prompts()
            self._prompts = result.prompts
            return result.prompts
        except McpError as e:
            logger.error(f"Error listing prompts for connector {self.public_identifier}: {e}")
            return []

    async def get_prompt(self, name: str, arguments: dict[str, Any] | None = None) -> GetPromptResult:
        """Get a prompt by name."""
        await self._ensure_connected()

        logger.debug(f"Getting prompt: {name}")
        result = await self.client_session.get_prompt(name, arguments)
        return result

    async def request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Send a raw request to the MCP implementation."""
        await self._ensure_connected()

        logger.debug(f"Sending request: {method} with params: {params}")
        return await self.client_session.request({"method": method, "params": params or {}})
