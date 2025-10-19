"""Middleware for MCP-specific logging."""

import json
import threading
import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

# Thread-local storage for MCP method info
_thread_local = threading.local()


class MCPLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware that extracts MCP method information from JSON-RPC requests."""

    def __init__(self, app, debug_level: int = 0, mcp_path: str = "/mcp"):
        super().__init__(app)
        self.debug_level = debug_level
        self.mcp_path = mcp_path

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Only process POST requests to the MCP endpoint
        if request.method != "POST" or not request.url.path.endswith(self.mcp_path):
            return await call_next(request)

        # Read request body
        body_bytes = await request.body()

        # Parse MCP method info
        method_info = self._parse_mcp_method(body_bytes)

        # Store method info for access logger
        if method_info:
            _thread_local.mcp_method_info = method_info

        # Create new request with body
        async def receive():
            return {"type": "http.request", "body": body_bytes}

        request_with_body = Request(request.scope, receive)

        # Execute request and measure time
        start_time = time.time()
        response = await call_next(request_with_body)

        # Log access info with MCP method stub
        if method_info:
            await self._log_access_info(request, method_info, response, start_time)

        # Log debug info only in DEBUG=2 mode
        if self.debug_level >= 2 and method_info:
            await self._log_debug_info(request, method_info, body_bytes, response, start_time)

        return response

    def _parse_mcp_method(self, body_bytes: bytes) -> dict | None:
        """Parse JSON-RPC body to extract MCP method information."""
        if not body_bytes:
            return None

        try:
            body_json = json.loads(body_bytes)
            method = body_json.get("method", "unknown")
            params = body_json.get("params", {})

            # Extract method name based on type
            name = None
            display = method

            if method == "tools/call" and "name" in params:
                name = params["name"]
                display = f"{method}:{name}"
            elif method == "resources/read" and "uri" in params:
                uri = params["uri"]
                name = uri.split("/")[-1] if "/" in uri else uri
                display = f"{method}:{name}"
            elif method == "prompts/get" and "name" in params:
                name = params["name"]
                display = f"{method}:{name}"

            return {"method": method, "name": name, "display": display, "session_id": body_json.get("id")}
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None

    async def _log_debug_info(
        self, request: Request, method_info: dict, body_bytes: bytes, response: Response, start_time: float
    ):
        """Log detailed debug information."""
        import logging

        logger = logging.getLogger("mcp.debug")

        duration_ms = (time.time() - start_time) * 1000

        # Log request (always in debug mode)
        logger.debug(f"JSON-RPC Request: {body_bytes.decode('utf-8')}")

        # Log response (always in debug mode)
        if hasattr(response, "body") and response.body:
            logger.debug(f"JSON-RPC Response: {response.body.decode('utf-8')}")
        else:
            logger.debug("JSON-RPC Response: [streaming response]")

        logger.debug(f"Duration: {duration_ms:.1f}ms")

    async def _log_access_info(self, request: Request, method_info: dict, response: Response, start_time: float):
        """Log access information with MCP method stub."""
        import logging

        logger = logging.getLogger("uvicorn.access")

        client_addr = f"{request.client.host}:{request.client.port}" if request.client else "unknown"
        method = request.method
        path = request.url.path
        status_code = response.status_code

        # Get MCP method info
        display = method_info.get("display", "unknown")

        # Build enhanced path with MCP method stub (no session ID) - bold the method
        enhanced_path = f"{path} [\033[1m{display}\033[0m]"

        # Pad HTTP method to align MCP methods
        padded_method = f"{method:<4}"  # Left-align with 4 characters width

        # Log in the same format as Uvicorn access logs with log level
        logger.info(f'{client_addr} - "{padded_method} {enhanced_path} HTTP/1.1" {status_code}')

    @staticmethod
    def get_method_info() -> dict | None:
        """Get method info for current thread."""
        return getattr(_thread_local, "mcp_method_info", None)
