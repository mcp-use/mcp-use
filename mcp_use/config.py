"""
Configuration loader for MCP session.

This module provides functionality to load MCP configuration from JSON files.
"""

import json
from typing import Any

from mcp_use.types.sandbox import SandboxOptions

from .connectors import (
    BaseConnector,
    HttpConnector,
    SandboxConnector,
    StdioConnector,
    WebSocketConnector,
)
from .connectors.utils import is_stdio_server


def load_config_file(filepath: str) -> dict[str, Any]:
    """Load a configuration file.

    Args:
        filepath: Path to the configuration file

    Returns:
        The parsed configuration
    """
    with open(filepath) as f:
        return json.load(f)


def create_connector_from_config(
    server_config: dict[str, Any],
    sandbox: bool = False,
    sandbox_options: SandboxOptions | None = None,
) -> BaseConnector:
    """Create a connector based on server configuration.
    This function can be called with just the server_config parameter:
    create_connector_from_config(server_config)
    Args:
        server_config: The server configuration section
        sandbox: Whether to use sandboxed execution mode for running MCP servers.
        sandbox_options: Optional sandbox configuration options.

    Returns:
        A configured connector instance
    """

    # Stdio connector (command-based)
    if is_stdio_server(server_config) and not sandbox:
        return StdioConnector(
            command=server_config["command"],
            args=server_config["args"],
            env=server_config.get("env", None),
        )

    # Sandboxed connector
    elif is_stdio_server(server_config) and sandbox:
        return SandboxConnector(
            command=server_config["command"],
            args=server_config["args"],
            env=server_config.get("env", None),
            e2b_options=sandbox_options,
        )

    # HTTP connector
    elif "url" in server_config:
        return HttpConnector(
            base_url=server_config["url"],
            headers=server_config.get("headers", None),
            auth_token=server_config.get("auth_token", None),
        )

    # WebSocket connector
    elif "ws_url" in server_config:
        return WebSocketConnector(
            url=server_config["ws_url"],
            headers=server_config.get("headers", None),
            auth_token=server_config.get("auth_token", None),
        )

    raise ValueError("Cannot determine connector type from config")
