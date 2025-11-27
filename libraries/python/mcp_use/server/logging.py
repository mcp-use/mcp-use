"""Simplified logging system for MCP servers."""

from mcp_use.server.logging_config import setup_logging
from mcp_use.server.middleware import MCPLoggingMiddleware

# Backward compatibility
MCPLoggingMiddleware = MCPLoggingMiddleware


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
