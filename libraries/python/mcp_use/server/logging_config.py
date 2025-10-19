"""Configurable logging setup for MCP servers."""

from mcp_use.server.formatters import ColoredFormatter, MCPAccessFormatter, MCPErrorFormatter


def setup_logging(debug_level: int = 0, log_level: str = "INFO") -> dict:
    """Set up logging configuration for MCP server.

    Args:
        debug_level: Debug level (0: production, 1: debug+routes, 2: debug+routes+jsonrpc)
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR)

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

    return {
        "version": 1,
        "disable_existing_loggers": False,
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
            "access": {
                "formatter": "access",
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
            },
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
