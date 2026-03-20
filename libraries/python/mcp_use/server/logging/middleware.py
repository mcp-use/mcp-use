"""MCP logging middleware."""

import json
import time
from collections.abc import AsyncIterator
from typing import cast

from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from mcp_use.server.logging.state import get_method_info, set_method_info

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
            set_method_info(method_info)

        # Create new request with body
        async def receive():
            return {"type": "http.request", "body": body_bytes}

        request_with_body = Request(request.scope, receive)

        # Execute request and measure time
        start_time = time.time()
        response = await call_next(request_with_body)

        # Capture response body for logging (need to read and reconstruct)
        # Limit to 1MB to prevent memory issues with large responses
        max_body_size = 1024 * 1024
        response_body: bytes | None = None
        response_too_large = False
        if self.debug_level >= 2 and method_info:
            body_iterator = getattr(response, "body_iterator", None)
            if body_iterator is not None:
                chunks = []
                total_size = 0
                iterator = cast(AsyncIterator[bytes], body_iterator)
                async for chunk in iterator:
                    chunks.append(chunk)
                    total_size += len(chunk)
                if total_size > max_body_size:
                    response_too_large = True
                else:
                    response_body = b"".join(chunks)
                # Reconstruct response with captured body
                response = Response(
                    content=b"".join(chunks),
                    status_code=response.status_code,
                    headers=dict(response.headers),
                    media_type=response.media_type,
                )

        # Log access info with MCP method stub
        if method_info:
            await self._log_access_info(request, method_info, response, start_time)

        # Log debug info if pretty_print is enabled OR debug_level >= 2
        if method_info and (self.pretty_print_jsonrpc or self.debug_level >= 2):
            await self._log_debug_info(request, method_info, body_bytes, response_body, start_time, response_too_large)

        return response

    def _extract_sse_data(self, text: str) -> str:
        """Extract JSON data from SSE format (event: message\\ndata: {...})."""
        for line in text.split("\n"):
            line = line.strip()
            if line.startswith("data:"):
                return line[5:].strip()
        return text

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
        self,
        request: Request,
        method_info: dict,
        request_body: bytes,
        response_body: bytes | None,
        start_time: float,
        response_too_large: bool = False,
    ):
        """Log detailed debug information."""
        duration_ms = (time.time() - start_time) * 1000
        display = method_info.get("display", "unknown")

        # Get raw request text
        request_text = request_body.decode("utf-8", errors="replace")

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
            if response_body:
                response_text = self._extract_sse_data(response_body.decode("utf-8", errors="replace"))
                try:
                    response_json = json.loads(response_text)
                    response_formatted = json.dumps(response_json, indent=2)
                except json.JSONDecodeError:
                    response_formatted = response_text
                syntax = Syntax(response_formatted, "json", theme=CODE_THEME)
                _console.print(Panel(syntax, title=f"[bold cyan]{display}[/] Response", title_align="left"))
            elif response_too_large:
                _console.print(f"[dim]{display} Response: <response too large to display>[/dim]")
        else:
            # Plain text logging
            print(f"\033[36mMCP:\033[0m  [{display}] Request ({duration_ms:.1f}ms): {request_text}")
            if response_body:
                response_text = self._extract_sse_data(response_body.decode("utf-8", errors="replace"))
                print(f"\033[36mMCP:\033[0m  [{display}] Response: {response_text}")
            elif response_too_large:
                print(f"\033[36mMCP:\033[0m  [{display}] Response: <response too large to display>")

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
        return get_method_info()
