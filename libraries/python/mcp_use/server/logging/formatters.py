"""Log formatters for MCP servers."""

import logging
import re

from uvicorn.logging import AccessFormatter

from mcp_use.server.logging.state import get_method_info


class ColoredFormatter(logging.Formatter):
    """Custom formatter with ANSI color codes matching the documentation format."""

    # ANSI color codes matching the Steps documentation
    COLORS = {
        "DEBUG": "\033[36m",  # Cyan (#06b6d4)
        "INFO": "\033[32m",  # Green (#10b981)
        "WARNING": "\033[33m",  # Yellow (#f59e0b)
        "ERROR": "\033[31m",  # Red (#ef4444)
        "CRITICAL": "\033[35m",  # Magenta (#ec4899)
        "RESET": "\033[0m",  # Reset
    }

    def __init__(self, fmt=None, datefmt=None):
        super().__init__(fmt, datefmt)

    def format(self, record):
        # Add color to levelname based on documentation colors
        if record.levelname in self.COLORS:
            record.levelname = f"{self.COLORS[record.levelname]}{record.levelname}{self.COLORS['RESET']}"

        return super().format(record)


class MCPAccessFormatter(AccessFormatter):
    """Enhanced access formatter that shows MCP method information."""

    def __init__(self, **kwargs):
        super().__init__()

    def formatMessage(self, record):
        # Handle custom MCP logs that don't have args
        if not hasattr(record, "args") or len(record.args) == 0:
            # This is a custom log from our middleware, just return the message
            return record.getMessage()

        # Let Uvicorn's AccessFormatter do most of the work
        recordcopy = logging.makeLogRecord(record.__dict__)

        # Check if this is an MCP POST request and enhance it
        if len(record.args) >= 3:
            client_addr, method, path = record.args[0], record.args[1], record.args[2]

            # Pad HTTP method for alignment
            padded_method = f"{method:<4}"

            if "/mcp" in path and method == "POST":  # TODO: Make this configurable
                # Get MCP method info from thread-local storage
                mcp_info = get_method_info()
                if mcp_info:
                    session_id = mcp_info.get("session_id")
                    display = mcp_info.get("display", "unknown")

                    # Enhance the path with MCP method info - bold the method
                    enhanced_path = f"{path}"
                    if session_id:
                        enhanced_path += f" [{session_id}]"
                    enhanced_path += f" [\033[1m{display}\033[0m]"

                    # Update the record args with padded method
                    recordcopy.args = (client_addr, padded_method, enhanced_path) + record.args[3:]
                else:
                    # Update the record args with padded method
                    recordcopy.args = (client_addr, padded_method, path) + record.args[3:]
            else:
                # Update the record args with padded method for non-MCP requests
                recordcopy.args = (client_addr, padded_method, path) + record.args[3:]

        # Format with log level prefix and colors
        formatted = super().formatMessage(recordcopy)
        levelname = record.levelname

        # Apply colors based on log level
        if levelname == "INFO":
            return f"\033[32m{levelname}:\033[0m {formatted}"
        elif levelname == "ERROR":
            return f"\033[31m{levelname}:\033[0m {formatted}"
        elif levelname == "WARNING":
            return f"\033[33m{levelname}:\033[0m {formatted}"
        elif levelname == "DEBUG":
            return f"\033[36m{levelname}:\033[0m {formatted}"
        else:
            return f"{levelname}: {formatted}"


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
