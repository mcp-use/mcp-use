"""Shared state for MCP server logging."""

import threading

# Thread-local storage for MCP method info
_thread_local = threading.local()


def set_method_info(info: dict | None) -> None:
    """Store method info for current thread."""
    _thread_local.mcp_method_info = info


def get_method_info() -> dict | None:
    """Get method info for current thread."""
    return getattr(_thread_local, "mcp_method_info", None)
