"""
Client for managing MCP servers and sessions.

This module provides a high-level client that manages MCP servers, connectors,
and sessions from configuration.
"""

import json
import warnings
from typing import Any

from .config import create_connector_from_config, load_config_file
from .connectors.base import BaseConnector
from .logging import logger
from .types.clientoptions import ClientOptions


class MCPClient:
    """Client for managing MCP servers and connectors.

    This class provides a unified interface for working with MCP servers,
    handling configuration, connector creation, and connection management.
    """

    def __init__(
        self,
        config: str | dict[str, Any] | None = None,
        options: ClientOptions | None = None,
    ) -> None:
        """Initialize a new MCP client.

        Args:
            config: Either a dict containing configuration or a path to a JSON config file.
                   If None, an empty configuration is used.
            options: Configuration options for the client.
        """
        self.config: dict[str, Any] = {}
        self.options = options or {}
        self.connectors: dict[str, BaseConnector] = {}
        self.active_connectors: list[str] = []

        # Load configuration if provided
        if config is not None:
            if isinstance(config, str):
                self.config = load_config_file(config)
            else:
                self.config = config

    @classmethod
    def from_dict(cls, config: dict[str, Any], options: ClientOptions | None = None) -> "MCPClient":
        """Create a MCPClient from a dictionary.

        Args:
            config: The configuration dictionary.
            options: Optional client configuration options.
        """
        return cls(config=config, options=options)

    @classmethod
    def from_config_file(cls, filepath: str, options: ClientOptions | None = None) -> "MCPClient":
        """Create a MCPClient from a configuration file.

        Args:
            filepath: The path to the configuration file.
            options: Optional client configuration options.
        """
        return cls(config=load_config_file(filepath), options=options)

    def add_server(
        self,
        name: str,
        server_config: dict[str, Any],
    ) -> None:
        """Add a server configuration.

        Args:
            name: The name to identify this server.
            server_config: The server configuration.
        """
        if "mcpServers" not in self.config:
            self.config["mcpServers"] = {}

        self.config["mcpServers"][name] = server_config

    def remove_server(self, name: str) -> None:
        """Remove a server configuration.

        Args:
            name: The name of the server to remove.
        """
        if "mcpServers" in self.config and name in self.config["mcpServers"]:
            del self.config["mcpServers"][name]

            # If we removed an active connector, remove it from active_connectors
            if name in self.active_connectors:
                self.active_connectors.remove(name)

    def get_server_names(self) -> list[str]:
        """Get the list of configured server names.

        Returns:
            List of server names.
        """
        return list(self.config.get("mcpServers", {}).keys())

    def save_config(self, filepath: str) -> None:
        """Save the current configuration to a file.

        Args:
            filepath: The path to save the configuration to.
        """
        with open(filepath, "w") as f:
            json.dump(self.config, f, indent=2)

    async def create_connector(
        self, server_name: str, auto_initialize: bool = True
    ) -> BaseConnector:
        """Create a connector for the specified server.

        Args:
            server_name: The name of the server to create a connector for.
            auto_initialize: Whether to automatically initialize the connector.

        Returns:
            The created BaseConnector.

        Raises:
            ValueError: If the specified server doesn't exist.
        """
        # Get server config
        servers = self.config.get("mcpServers", {})
        if not servers:
            warnings.warn("No MCP servers defined in config", UserWarning, stacklevel=2)
            return None

        if server_name not in servers:
            raise ValueError(f"Server '{server_name}' not found in config")

        server_config = servers[server_name]

        # Create connector with options
        connector = create_connector_from_config(server_config, options=self.options)

        # Initialize the connector if requested
        if auto_initialize:
            await connector.initialize()
        self.connectors[server_name] = connector

        # Add to active connectors
        if server_name not in self.active_connectors:
            self.active_connectors.append(server_name)

        return connector

    async def create_all_connectors(
        self,
        auto_initialize: bool = True,
    ) -> dict[str, BaseConnector]:
        """Create connectors for all configured servers.

        Args:
            auto_initialize: Whether to automatically initialize the connectors.

        Returns:
            Dictionary mapping server names to their BaseConnector instances.

        Warns:
            UserWarning: If no servers are configured.
        """
        # Get server config
        servers = self.config.get("mcpServers", {})
        if not servers:
            warnings.warn("No MCP servers defined in config", UserWarning, stacklevel=2)
            return {}

        # Create connectors for all servers
        for name in servers:
            connector = await self.create_connector(name, auto_initialize)
            if auto_initialize:
                await connector.initialize()

        return self.connectors

    def get_connector(self, server_name: str) -> BaseConnector:
        """Get an existing connector.

        Args:
            server_name: The name of the server to get the connector for.

        Returns:
            The BaseConnector for the specified server.

        Raises:
            ValueError: If no active connectors exist or the specified connector doesn't exist.
        """
        if server_name not in self.connectors:
            raise ValueError(f"No connector exists for server '{server_name}'")

        return self.connectors[server_name]

    def get_all_active_connectors(self) -> dict[str, BaseConnector]:
        """Get all active connectors.

        Returns:
            Dictionary mapping server names to their BaseConnector instances.
        """
        return {
            name: self.connectors[name]
            for name in self.active_connectors
            if name in self.connectors
        }

    async def close_connector(self, server_name: str) -> None:
        """Close a connector.

        Args:
            server_name: The name of the server to close the connector for.

        Raises:
            ValueError: If no active connectors exist or the specified connector doesn't exist.
        """
        # Check if the connector exists
        if server_name not in self.connectors:
            logger.warning(f"No connector exists for server '{server_name}', nothing to close")
            return

        # Get the connector
        connector = self.connectors[server_name]

        try:
            # Disconnect from the connector
            logger.debug(f"Closing connector for server '{server_name}'")
            await connector.disconnect()
        except Exception as e:
            logger.error(f"Error closing connector for server '{server_name}': {e}")
        finally:
            # Remove the connector regardless of whether disconnect succeeded
            del self.connectors[server_name]

            # Remove from active_connectors
            if server_name in self.active_connectors:
                self.active_connectors.remove(server_name)

    async def close_all_connectors(self) -> None:
        """Close all active connectors.

        This method ensures all connectors are closed even if some fail.
        """
        # Get a list of all connector names first to avoid modification during iteration
        server_names = list(self.connectors.keys())
        errors = []

        for server_name in server_names:
            try:
                logger.debug(f"Closing connector for server '{server_name}'")
                await self.close_connector(server_name)
            except Exception as e:
                error_msg = f"Failed to close connector for server '{server_name}': {e}"
                logger.error(error_msg)
                errors.append(error_msg)

        # Log summary if there were errors
        if errors:
            logger.error(f"Encountered {len(errors)} errors while closing connectors")
        else:
            logger.debug("All connectors closed successfully")

    # Backward compatibility methods for session-based API
    async def create_session(self, server_name: str, auto_initialize: bool = True) -> BaseConnector:
        """Create a session (now returns a connector for backward compatibility)."""
        return await self.create_connector(server_name, auto_initialize)

    async def create_all_sessions(self, auto_initialize: bool = True) -> dict[str, BaseConnector]:
        """Create all sessions (now returns connectors for backward compatibility)."""
        return await self.create_all_connectors(auto_initialize)

    def get_session(self, server_name: str) -> BaseConnector:
        """Get a session (now returns a connector for backward compatibility)."""
        return self.get_connector(server_name)

    def get_all_active_sessions(self) -> dict[str, BaseConnector]:
        """Get all active sessions (now returns connectors for backward compatibility)."""
        return self.get_all_active_connectors()

    async def close_session(self, server_name: str) -> None:
        """Close a session (now closes a connector for backward compatibility)."""
        await self.close_connector(server_name)

    async def close_all_sessions(self) -> None:
        """Close all sessions (now closes connectors for backward compatibility)."""
        await self.close_all_connectors()

    # Legacy property for backward compatibility
    @property
    def sessions(self) -> dict[str, BaseConnector]:
        """Legacy property that returns connectors for backward compatibility."""
        return self.connectors

    @property
    def active_sessions(self) -> list[str]:
        """Legacy property that returns active connectors for backward compatibility."""
        return self.active_connectors
