"""
Configuration loader for MCP session.

This module provides functionality to load MCP configuration from JSON files.
"""

import json
from typing import Any

from .connectors import (
    BaseConnector,
    HttpConnector,
    SandboxConnector,
    StdioConnector,
    WebSocketConnector,
)
from .connectors.utils import is_stdio_server
from .types.clientoptions import ClientOptions


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
    options: ClientOptions | None = None,
) -> BaseConnector:
    """Create a connector based on server configuration.
    This function can be called with just the server_config parameter:
    create_connector_from_config(server_config)
    Args:
        server_config: The server configuration section
        options: Optional client configuration options including sandboxing preferences.
                 If None, default client options will be used.

    Returns:
        A configured connector instance
    """
    # Use default options if none provided
    options = options or {"is_sandboxed": False}

    # Stdio connector (command-based)
    if is_stdio_server(server_config) and not options.get("is_sandboxed", False):
        return StdioConnector(
            command=server_config["command"],
            args=server_config["args"],
            env=server_config.get("env", None),
        )

    # Sandboxed connector
    elif is_stdio_server(server_config) and options.get("is_sandboxed", False):
        return SandboxConnector(
            command=server_config["command"],
            args=server_config["args"],
            env=server_config.get("env", None),
            e2b_options=options.get("sandbox_options", {}),
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
