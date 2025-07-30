"""
mcp_use - An MCP library for LLMs.

This library provides a unified interface for connecting different LLMs
to MCP tools through existing LangChain adapters.
"""

import sys
from importlib.metadata import version

# Python version compatibility check
if sys.version_info[:2] == (3, 10):
    import warnings

    warnings.warn(
        "mcp-use requires Python 3.11+ due to asyncio subprocess issues in Python 3.10. "
        "Python 3.10 may work but can show 'Event loop is closed' warnings on exit. "
        "For the best experience, please upgrade to Python 3.11 or newer.",
        UserWarning,
        stacklevel=2,
    )

    # Apply minimal patch to fix subprocess cleanup in Python 3.10
    try:
        from asyncio.base_subprocess import BaseSubprocessTransport

        # Store original __del__ method
        _original_subprocess_del = BaseSubprocessTransport.__del__

        def _safe_subprocess_del(self):
            """Safe version of BaseSubprocessTransport.__del__ that doesn't raise on closed loop."""
            try:
                # Check if loop is closed before cleanup
                if hasattr(self._loop, "_closed") and self._loop._closed:
                    return
                _original_subprocess_del(self)
            except RuntimeError as e:
                if "Event loop is closed" not in str(e):
                    raise
                # Silently ignore "Event loop is closed" errors

        # Apply the minimal patch
        BaseSubprocessTransport.__del__ = _safe_subprocess_del

    except (ImportError, AttributeError):
        # If we can't patch, that's fine - just continue
        pass

from . import observability
from .agents.mcpagent import MCPAgent
from .client import MCPClient
from .config import load_config_file
from .connectors import BaseConnector, HttpConnector, StdioConnector, WebSocketConnector
from .logging import MCP_USE_DEBUG, Logger, logger
from .session import MCPSession

__version__ = version("mcp-use")

__all__ = [
    "MCPAgent",
    "MCPClient",
    "MCPSession",
    "BaseConnector",
    "StdioConnector",
    "WebSocketConnector",
    "HttpConnector",
    "create_session_from_config",
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
