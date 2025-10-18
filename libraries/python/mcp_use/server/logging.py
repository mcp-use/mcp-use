import json
import logging
import threading

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from uvicorn.logging import AccessFormatter

# Configuration for which library logs to suppress
SUPPRESSED_LOGGERS = {
    "uvicorn.error": "ERROR",
    "mcp.server.lowlevel.server": "CRITICAL",
    "mcp.server.streamable_http_manager": "CRITICAL",
    "mcp.server.fastmcp": "CRITICAL",
    "mcp": "CRITICAL",
}

# Thread-safe storage for MCP method info
_mcp_methods: dict[str, tuple[str, str | None]] = {}
_mcp_methods_lock = threading.Lock()


def store_mcp_method(client_addr: str, method: str, session_id: str | None = None) -> None:
    """Store MCP method info for a client."""
    with _mcp_methods_lock:
        _mcp_methods[client_addr] = (method, session_id)


def get_mcp_method(client_addr: str) -> tuple[str, str | None] | None:
    """Get and remove MCP method info for a client."""
    with _mcp_methods_lock:
        return _mcp_methods.pop(client_addr, None)


class MCPAccessFormatter(AccessFormatter):
    """Custom Uvicorn access formatter that enhances MCP requests with JSON-RPC method info."""

    def formatMessage(self, record):
        # Let Uvicorn's AccessFormatter do most of the work
        recordcopy = logging.makeLogRecord(record.__dict__)

        # Check if this is an MCP POST request and try to enhance it
        if hasattr(record, "args") and len(record.args) >= 3:
            client_addr, method, path = record.args[0], record.args[1], record.args[2]

            if "/mcp" in path and method == "POST":
                # Try to get the stored MCP method for this client
                mcp_info = get_mcp_method(client_addr)
                if mcp_info:
                    mcp_method, session_id = mcp_info
                    # Enhance the path with MCP method info
                    enhanced_path = f"{path}"
                    if session_id:
                        enhanced_path += f" [{session_id}]"
                    enhanced_path += f" [{mcp_method}]"
                    # Update the record args
                    recordcopy.args = record.args[:2] + (enhanced_path,) + record.args[3:]

        return super().formatMessage(recordcopy)


class MCPErrorFormatter(logging.Formatter):
    """Custom error formatter that provides helpful messages for common errors."""

    def format(self, record):
        msg = record.getMessage()

        # Customize port conflict errors
        if "address already in use" in msg.lower():
            import re

            port_match = re.search(r"'([^']+)', (\d+)", msg)
            if port_match:
                host, port = port_match.groups()
                return (
                    f"Port {port} is already in use. Please:\n"
                    f"  • Stop the process using this port, or\n"
                    f"  • Use a different port: server.run(transport='streamable-http', port=XXXX)"
                )

        return msg


class MCPEnhancerMiddleware(BaseHTTPMiddleware):
    """Lightweight middleware that stores MCP method info for the logger."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Only process MCP POST requests
        if request.method == "POST":
            body_bytes = await request.body()

            async def receive():
                return {"type": "http.request", "body": body_bytes}

            request_with_body = Request(request.scope, receive)

            # Extract MCP method and store it for the logger
            if body_bytes:
                try:
                    body_json = json.loads(body_bytes)
                    if isinstance(body_json, dict):
                        mcp_method = body_json.get("method", "unknown")

                        # Extract additional details for specific methods
                        params = body_json.get("params", {})
                        if isinstance(params, dict):
                            if mcp_method == "tools/call" and "name" in params:
                                mcp_method = f"{mcp_method}:{params['name']}"
                            elif mcp_method == "resources/read" and "uri" in params:
                                # Extract just the resource name from URI
                                uri = params["uri"]
                                resource_name = uri.split("/")[-1] if "/" in uri else uri
                                mcp_method = f"{mcp_method}:{resource_name}"
                            elif mcp_method == "prompts/get" and "name" in params:
                                mcp_method = f"{mcp_method}:{params['name']}"
                            elif (
                                mcp_method == "resources/list"
                                or mcp_method == "tools/list"
                                or mcp_method == "prompts/list"
                            ):
                                # Keep as-is for list methods
                                pass
                    else:
                        mcp_method = "batch"

                    # Extract session ID from header
                    session_id = request.headers.get("mcp-session-id")

                    # Store using client address as key
                    client_addr = f"{request.client.host}:{request.client.port}"
                    store_mcp_method(client_addr, mcp_method, session_id)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    pass

            return await call_next(request_with_body)
        else:
            return await call_next(request)


# Logging configuration constant
MCP_LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "access": {
            "()": "mcp_use.server.logging.MCPAccessFormatter",
            "fmt": '%(levelprefix)s %(client_addr)s - "%(request_line)s" %(status_code)s',
        },
        "error": {
            "()": "mcp_use.server.logging.MCPErrorFormatter",
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
        "null": {
            "class": "logging.NullHandler",
        },
    },
    "loggers": {
        # Keep our custom access logs
        "uvicorn.access": {"handlers": ["access"], "level": "INFO", "propagate": False},
        # Show errors with our custom format
        "uvicorn.error": {"handlers": ["error"], "level": "ERROR", "propagate": False},
        # Silence unwanted startup logs
        **{
            logger_name: {"handlers": ["null"], "level": level, "propagate": False}
            for logger_name, level in SUPPRESSED_LOGGERS.items()
            if logger_name != "uvicorn.error"
        },
    },
}
