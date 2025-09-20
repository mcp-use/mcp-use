"""
mcp_use - An MCP library for LLMs.

This library provides a unified interface for connecting different LLMs
to MCP tools through existing LangChain adapters.
"""

from importlib.metadata import version

# Import logging FIRST to ensure it's configured before other modules
# This MUST happen before importing observability to ensure loggers are configured
from .logging import MCP_USE_DEBUG, Logger, logger  # isort: skip

# Now import other modules - observability must come after logging
from .agent import managers, observability  # noqa: E402
from .agent.mcpagent import MCPAgent
from .client import connectors
from .client.client import MCPClient
from .client.config import load_config_file
from .client.connectors import BaseConnector, HttpConnector, StdioConnector, WebSocketConnector
from .client.session import MCPSession

__version__ = version("mcp-use")

__all__ = [
    "MCPAgent",
    "MCPClient",
    "MCPSession",
    "BaseConnector",
    "StdioConnector",
    "WebSocketConnector",
    "HttpConnector",
    "connectors",
    "managers",
    "load_config_file",
    "logger",
    "MCP_USE_DEBUG",
    "Logger",
    "set_debug",
    "observability",
]


# Helper function to set debug mode
def set_debug(debug=2):
    """Set the debug mode for mcp_use.

    Args:
        debug: Whether to enable debug mode (default: True)
    """
    Logger.set_debug(debug)
