"""Simplified logging system for MCP servers."""

from mcp_use.server.logging_config import setup_logging
from mcp_use.server.middleware import MCPLoggingMiddleware

# Backward compatibility
MCPLoggingMiddleware = MCPLoggingMiddleware


def get_logging_config(debug_level: int = 0) -> dict:
    """Get logging configuration for MCP server.

    Args:
        debug_level: Debug level (0: production, 1: debug+routes, 2: debug+routes+jsonrpc)

    Returns:
        Uvicorn logging configuration dict
    """
    return setup_logging(debug_level=debug_level)


# Legacy constant for backward compatibility
MCP_LOGGING_CONFIG = get_logging_config()
