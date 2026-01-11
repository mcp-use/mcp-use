"""Logging system for MCP servers."""

from mcp_use.server.logging.config import setup_logging
from mcp_use.server.logging.formatters import ColoredFormatter, MCPAccessFormatter, MCPErrorFormatter
from mcp_use.server.logging.middleware import MCPLoggingMiddleware
from mcp_use.server.logging.state import get_method_info, set_method_info


def get_logging_config(
    debug_level: int = 0, show_inspector_logs: bool = False, inspector_path: str = "/inspector"
) -> dict:
    """Get logging configuration for MCP server.

    Args:
        debug_level: Debug level (0: production, 1: debug+routes, 2: debug+routes+jsonrpc)
        show_inspector_logs: Whether to show inspector-related access logs (default: False)
        inspector_path: Path prefix for inspector routes

    Returns:
        Uvicorn logging configuration dict
    """
    return setup_logging(
        debug_level=debug_level, show_inspector_logs=show_inspector_logs, inspector_path=inspector_path
    )


# Legacy constant for backward compatibility
MCP_LOGGING_CONFIG = get_logging_config()

__all__ = [
    "MCPLoggingMiddleware",
    "get_logging_config",
    "get_method_info",
    "set_method_info",
    "setup_logging",
    "ColoredFormatter",
    "MCPAccessFormatter",
    "MCPErrorFormatter",
    "MCP_LOGGING_CONFIG",
]
