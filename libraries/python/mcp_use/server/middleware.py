"""Middleware for MCP-specific logging."""

import json
import threading
import time

from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

# Thread-local storage for MCP method info
_thread_local = threading.local()

# Rich console for formatted output
_console = Console()
CODE_THEME = "nord"


class MCPLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware that extracts MCP method information from JSON-RPC requests."""

    def __init__(self, app, debug_level: int = 0, mcp_path: str = "/mcp", pretty_print_jsonrpc: bool = False):
        super().__init__(app)
        self.debug_level = debug_level
        self.mcp_path = mcp_path
        self.pretty_print_jsonrpc = pretty_print_jsonrpc

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
        duration_ms = (time.time() - start_time) * 1000
        display = method_info.get("display", "unknown")

        # Get raw request text
        request_text = body_bytes.decode("utf-8", errors="replace")

        if self.pretty_print_jsonrpc:
            # Pretty print with Rich panels
            try:
                request_json = json.loads(request_text)
                request_formatted = json.dumps(request_json, indent=2)
            except json.JSONDecodeError:
                request_formatted = request_text

            syntax = Syntax(request_formatted, "json", theme=CODE_THEME)
            _console.print(
                Panel(
                    syntax,
                    title=f"[bold]{display}[/] Request",
                    title_align="left",
                    subtitle=f"{duration_ms:.1f}ms",
                )
            )

            # Format and print response if available
            if hasattr(response, "body") and response.body:
                response_text = response.body.decode("utf-8", errors="replace")
                try:
                    response_json = json.loads(response_text)
                    response_formatted = json.dumps(response_json, indent=2)
                except json.JSONDecodeError:
                    response_formatted = response_text
                syntax = Syntax(response_formatted, "json", theme=CODE_THEME, background_color="dim")
                _console.print(Panel(syntax, title=f"[bold cyan]{display}[/] Response", title_align="left"))
        else:
            # Plain text logging
            print(f"\033[36mMCP:\033[0m  [{display}] Request ({duration_ms:.1f}ms): {request_text}")
            if hasattr(response, "body") and response.body:
                response_text = response.body.decode("utf-8", errors="replace")
                print(f"\033[36mMCP:\033[0m  [{display}] Response: {response_text}")

    async def _log_access_info(self, request: Request, method_info: dict, response: Response, start_time: float):
        """Log access information with MCP method stub."""
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

        # Print with MCP: prefix (green like INFO) - 2 spaces to align with "INFO: "
        print(f'\033[32mMCP:\033[0m  {client_addr} - "{padded_method} {enhanced_path} HTTP/1.1" {status_code}')

    @staticmethod
    def get_method_info() -> dict | None:
        """Get method info for current thread."""
        return getattr(_thread_local, "mcp_method_info", None)
