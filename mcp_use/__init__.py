"""
MCP Use - A library for using MCP servers with LLMs.
"""

from importlib.metadata import version

from .adapters import LangChainAdapter
from .agents import MCPAgent
from .client import MCPClient
from .config import load_config_file, load_dxt_file
from .dxt import DXTError, DXTParser, load_dxt_config, validate_user_config
from .session import MCPSession

__version__ = version("mcp-use")

__all__ = [
    "MCPClient",
    "MCPAgent",
    "MCPSession",
    "LangChainAdapter",
    "load_config_file",
    "load_dxt_file",
    "DXTError",
    "DXTParser",
    "load_dxt_config",
    "validate_user_config",
]


# Helper function to set debug mode
def set_debug(debug=2):
    """Set the debug mode for mcp_use.

    Args:
        debug: Whether to enable debug mode (default: True)
    """
    from .logging import Logger

    Logger.set_debug(debug)
