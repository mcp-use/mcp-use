"""Log formatters for MCP servers."""

import logging
import re
from dataclasses import dataclass

from uvicorn.logging import AccessFormatter

from mcp_use.server.logging.state import get_method_info

# ANSI escape codes
BOLD = "\033[1m"
RESET = "\033[0m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
MAGENTA = "\033[35m"


@dataclass
class UvicornAccessArgs:
    """
    Uvicorn access logs use a tuple format: (client_addr, method, path, ...).

    This class provides named access to make the code more readable.
    See: https://github.com/encode/uvicorn/blob/master/uvicorn/logging.py
    """

    client_addr: str
    method: str
    path: str
    extra: tuple

    @classmethod
    def from_record_args(cls, args: tuple) -> "UvicornAccessArgs | None":
        """Parse Uvicorn's access log args tuple into named fields."""
        if len(args) < 3:
            return None
        return cls(
            client_addr=str(args[0]),
            method=str(args[1]),
            path=str(args[2]),
            extra=args[3:],
        )

    def is_mcp_request(self, mcp_path: str = "/mcp") -> bool:
        """Check if this is a POST request to the MCP endpoint."""
        return self.method == "POST" and mcp_path in self.path

    def to_tuple(self, path_override: str | None = None, method_override: str | None = None) -> tuple:
        """Convert back to tuple format for Uvicorn's formatter."""
        return (
            self.client_addr,
            method_override or self.method,
            path_override or self.path,
        ) + self.extra


class ColoredFormatter(logging.Formatter):
    """Custom formatter with ANSI color codes."""

    COLORS = {
        "DEBUG": CYAN,
        "INFO": GREEN,
        "WARNING": YELLOW,
        "ERROR": RED,
        "CRITICAL": MAGENTA,
    }

    def __init__(self, fmt=None, datefmt=None):
        super().__init__(fmt, datefmt)

    def format(self, record):
        if record.levelname in self.COLORS:
            color = self.COLORS[record.levelname]
            record.levelname = f"{color}{record.levelname}{RESET}"
        return super().format(record)


class MCPAccessFormatter(AccessFormatter):
    """
    Enhanced Uvicorn access formatter that shows MCP method information.

    For MCP requests, enhances the log with JSON-RPC method info from thread-local storage.
    """

    def __init__(self, **kwargs):
        super().__init__()

    def formatMessage(self, record):
        args = record.args

        # Non-Uvicorn logs (e.g., from our middleware) don't have args
        if args is None or not isinstance(args, tuple) or len(args) == 0:
            return record.getMessage()

        # Parse Uvicorn's access log format
        access_args = UvicornAccessArgs.from_record_args(args)
        if access_args is None:
            return record.getMessage()

        # Pad HTTP method for visual alignment (GET, POST, PUT, etc.)
        padded_method = f"{access_args.method:<4}"

        # Enhance MCP requests with JSON-RPC method info
        final_path = access_args.path
        if access_args.is_mcp_request():
            mcp_info = get_method_info()
            if mcp_info:
                display = mcp_info.get("display", "unknown")
                final_path = f"{access_args.path} [{BOLD}{display}{RESET}]"

        # Update record with formatted args
        recordcopy = logging.makeLogRecord(record.__dict__)
        recordcopy.args = access_args.to_tuple(path_override=final_path, method_override=padded_method)

        # Format and add colored level prefix
        formatted = super().formatMessage(recordcopy)
        return self._add_level_prefix(record.levelname, formatted)

    def _add_level_prefix(self, levelname: str, message: str) -> str:
        """Add colored level prefix to the message."""
        colors = {"INFO": GREEN, "ERROR": RED, "WARNING": YELLOW, "DEBUG": CYAN}
        color = colors.get(levelname, "")
        if color:
            return f"{color}{levelname}:{RESET} {message}"
        return f"{levelname}: {message}"


class MCPErrorFormatter(logging.Formatter):
    """Custom error formatter with helpful messages."""

    def format(self, record):
        msg = record.getMessage()

        # Customize port conflict errors
        if "address already in use" in msg.lower():
            port_match = re.search(r"'([^']+)', (\d+)", msg)
            if port_match:
                host, port = port_match.groups()
                return (
                    f"Port {port} is already in use. Please:\n"
                    f"  • Stop the process using this port, or\n"
                    f"  • Use a different port: server.run(transport='streamable-http', port=XXXX)"
                )

        return msg
