"""Configurable logging setup for MCP servers."""

import logging

from mcp_use.server.logging.formatters import ColoredFormatter, MCPAccessFormatter, MCPErrorFormatter


class InspectorLogFilter(logging.Filter):
    """Filter that hides inspector-related access logs."""

    def __init__(self, inspector_path: str = "/inspector"):
        super().__init__()
        self.inspector_path = inspector_path

    def filter(self, record: logging.LogRecord) -> bool:
        # Check if args contain a path that starts with inspector_path
        args = record.args
        if args is not None and isinstance(args, tuple) and len(args) >= 3:
            path = args[2]
            if isinstance(path, str) and self.inspector_path in path:
                return False
        return True


def setup_logging(
    debug_level: int = 0, log_level: str = "INFO", show_inspector_logs: bool = False, inspector_path: str = "/inspector"
) -> dict:
    """Set up logging configuration for MCP server.

    Args:
        debug_level: Debug level (0: production, 1: debug+routes, 2: debug+routes+jsonrpc)
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR)
        show_inspector_logs: Whether to show inspector-related access logs (default: False)
        inspector_path: Path prefix for inspector routes

    Returns:
        Uvicorn logging configuration dict
    """

    # Suppress noisy loggers
    suppressed_loggers = {
        "uvicorn.error": "ERROR",
        "mcp.server.lowlevel.server": "CRITICAL",
        "mcp.server.streamable_http_manager": "CRITICAL",
        "mcp.server.fastmcp": "CRITICAL",
        "mcp": "CRITICAL",
        "httpx": "WARNING",
    }

    # Configure loggers
    loggers = {
        # Access logs with MCP enhancement (handled by middleware)
        "uvicorn.access": {"handlers": ["access"], "level": log_level, "propagate": False},
        # Error logs with custom formatting
        "uvicorn.error": {"handlers": ["error"], "level": "ERROR", "propagate": False},
        # Suppress noisy loggers
        **{
            logger_name: {"handlers": ["null"], "level": level, "propagate": False}
            for logger_name, level in suppressed_loggers.items()
            if logger_name != "uvicorn.error"
        },
    }

    # Add debug logger if debug mode is enabled
    if debug_level >= 2:
        loggers["mcp.debug"] = {"handlers": ["debug"], "level": "DEBUG", "propagate": False}

    # Build filters
    filters = {}
    if not show_inspector_logs:
        filters["inspector_filter"] = {"()": InspectorLogFilter, "inspector_path": inspector_path}

    # Build access handler with optional filter
    access_handler = {
        "formatter": "access",
        "class": "logging.StreamHandler",
        "stream": "ext://sys.stdout",
    }
    if not show_inspector_logs:
        access_handler["filters"] = ["inspector_filter"]

    return {
        "version": 1,
        "disable_existing_loggers": False,
        "filters": filters,
        "formatters": {
            "access": {
                "()": MCPAccessFormatter,
            },
            "error": {
                "()": MCPErrorFormatter,
            },
            "debug": {
                "fmt": "%(levelname)s: %(message)s",
            },
            "colored": {
                "()": ColoredFormatter,
                "fmt": "%(levelname)-8s %(name)s: %(message)s",
            },
        },
        "handlers": {
            "access": access_handler,
            "error": {
                "formatter": "error",
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stderr",
            },
            "debug": {
                "formatter": "colored" if debug_level >= 2 else "debug",
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
            },
            "null": {
                "class": "logging.NullHandler",
            },
        },
        "loggers": loggers,
    }
