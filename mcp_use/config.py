"""
Configuration loader for MCP session.

This module provides functionality to load MCP configuration from JSON files.
"""

import json
from typing import Any

from mcp.client.session import ElicitationFnT, LoggingFnT, MessageHandlerFnT, SamplingFnT

from mcp_use.types.sandbox import SandboxOptions

from .connectors import BaseConnector, HttpConnector, SandboxConnector, StdioConnector, WebSocketConnector
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
    sampling_callback: SamplingFnT | None = None,
    elicitation_callback: ElicitationFnT | None = None,
    message_handler: MessageHandlerFnT | None = None,
    logging_callback: LoggingFnT | None = None,
) -> BaseConnector:
    """Create a connector based on server configuration.
    This function can be called with just the server_config parameter:
    create_connector_from_config(server_config)
    Args:
        server_config: The server configuration section
        sandbox: Whether to use sandboxed execution mode for running MCP servers.
        sandbox_options: Optional sandbox configuration options.
        sampling_callback: Optional sampling callback function.
    Returns:
        A configured connector instance
    """

    # Stdio connector (command-based)
    if is_stdio_server(server_config) and not sandbox:
        return StdioConnector(
            command=server_config["command"],
            args=server_config["args"],
            env=server_config.get("env", None),
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
        )

    # Sandboxed connector
    elif is_stdio_server(server_config) and sandbox:
        return SandboxConnector(
            command=server_config["command"],
            args=server_config["args"],
            env=server_config.get("env", None),
            e2b_options=sandbox_options,
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
        )

    # HTTP connector
    elif "url" in server_config:
        return HttpConnector(
            base_url=server_config["url"],
            headers=server_config.get("headers", None),
            auth_token=server_config.get("auth_token", None),
            timeout=server_config.get("timeout", 5),
            sse_read_timeout=server_config.get("sse_read_timeout", 60 * 5),
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
        )

    # WebSocket connector
    elif "ws_url" in server_config:
        return WebSocketConnector(
            url=server_config["ws_url"],
            headers=server_config.get("headers", None),
            auth_token=server_config.get("auth_token", None),
        )

    raise ValueError("Cannot determine connector type from config")
