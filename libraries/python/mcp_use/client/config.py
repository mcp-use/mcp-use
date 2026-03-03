"""
Configuration loader for MCP session.

This module provides functionality to load MCP configuration from JSON files.
"""

import json
from typing import Any

from mcp.client.session import ElicitationFnT, ListRootsFnT, LoggingFnT, MessageHandlerFnT, SamplingFnT
from mcp.types import Root

from mcp_use.client.connectors.base import BaseConnector
from mcp_use.client.connectors.http import HttpConnector
from mcp_use.client.connectors.sandbox import SandboxConnector, SandboxOptions
from mcp_use.client.connectors.stdio import StdioConnector
from mcp_use.client.connectors.utils import is_stdio_server
from mcp_use.client.connectors.websocket import WebSocketConnector
from mcp_use.client.middleware import Middleware
from mcp_use.telemetry.telemetry import Telemetry

_telemetry = Telemetry()


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
    middleware: list[Middleware] | None = None,
    verify: bool | None = True,
    roots: list[Root] | None = None,
    list_roots_callback: ListRootsFnT | None = None,
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
        _telemetry.track_connector_init(
            connector_type="stdio",
            server_command=server_config["command"],
            server_args=server_config["args"],
            public_identifier=f"stdio:{server_config['command']} {' '.join(server_config['args'])}",
        )
        return StdioConnector(
            command=server_config["command"],
            args=server_config["args"],
            env=server_config.get("env", None),
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
            middleware=middleware,
            roots=roots,
            list_roots_callback=list_roots_callback,
        )

    # Sandboxed connector
    elif is_stdio_server(server_config) and sandbox:
        _telemetry.track_connector_init(
            connector_type="sandbox",
            server_command=server_config["command"],
            server_args=server_config["args"],
            public_identifier=f"sandbox:{server_config['command']} {' '.join(server_config['args'])}",
        )
        return SandboxConnector(
            command=server_config["command"],
            args=server_config["args"],
            env=server_config.get("env", None),
            e2b_options=sandbox_options,
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
            middleware=middleware,
            roots=roots,
            list_roots_callback=list_roots_callback,
        )

    # HTTP connector
    elif "url" in server_config:
        _telemetry.track_connector_init(
            connector_type="http",
            server_url=server_config["url"],
            public_identifier=f"http:{server_config['url']}",
        )
        return HttpConnector(
            base_url=server_config["url"],
            headers=server_config.get("headers", None),
            auth=server_config.get("auth") or None,
            timeout=server_config.get("timeout", 5),
            sse_read_timeout=server_config.get("sse_read_timeout", 60 * 5),
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
            middleware=middleware,
            verify=verify,
            roots=roots,
            list_roots_callback=list_roots_callback,
        )

    # WebSocket connector
    elif "ws_url" in server_config:
        _telemetry.track_connector_init(
            connector_type="websocket",
            server_url=server_config["ws_url"],
            public_identifier=f"websocket:{server_config['ws_url']}",
        )
        return WebSocketConnector(
            url=server_config["ws_url"],
            headers=server_config.get("headers", None),
            auth=server_config.get("auth") or None,
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
            middleware=middleware,
            roots=roots,
            list_roots_callback=list_roots_callback,
        )

    raise ValueError("Cannot determine connector type from config")
