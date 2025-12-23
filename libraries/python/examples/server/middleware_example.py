"""
Minimal MCP Server Middleware Example

- Logging (on_request, on_call_tool)
- Auth (x-api-key)
- Rate limiting (per session)
- Validation (simple)
- Tools: echo, session_id

Session IDs come from the SDK via the mcp-session-id header (context.session_id).
Spec: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management
"""

import time
from collections import defaultdict
from datetime import datetime
from typing import Any

from mcp_use.server import MCPServer
from mcp_use.server.middleware import CallNext, Middleware, ServerMiddlewareContext


class ConnectionGuard(Middleware):
    async def on_initialize(self, context, call_next):
        client_name = context.message.clientInfo.name
        print(f"Incoming connection from: {client_name}")

        return await call_next(context)


class LoggingMiddleware(Middleware):
    """Minimal logging."""

    async def on_request(self, context: ServerMiddlewareContext[Any], call_next: CallNext[Any, Any]) -> Any:
        start = time.time()
        sid = context.session_id or "anonymous"
        print(f"[{context.method}] sid={sid}")
        try:
            result = await call_next(context)
            print(f"[{context.method}] ok ({(time.time() - start) * 1000:.1f}ms)")
            return result
        except Exception as e:
            print(f"[{context.method}] failed: {e}")
            raise

    async def on_call_tool(self, context, call_next):
        print(f"  tool={context.message.name} args={context.message.arguments or {}}")
        return await call_next(context)


class AuthenticationMiddleware(Middleware):
    """Tiny x-api-key check."""

    def __init__(self, valid_api_keys: set[str] | None = None):
        self.valid_api_keys = valid_api_keys or {"test-key-123"}

    async def on_call_tool(self, context, call_next):
        api_key = context.headers.get("x-api-key") if context.headers else None
        if api_key and api_key not in self.valid_api_keys:
            raise PermissionError("Invalid API key")
        return await call_next(context)


class RateLimitingMiddleware(Middleware):
    """Per-session rate limit (simple)."""

    def __init__(self, max_requests_per_minute: int = 30):
        self.max = max_requests_per_minute
        self.seen: dict[str, list[datetime]] = defaultdict(list)

    async def on_call_tool(self, context, call_next):
        sid = context.session_id or "anonymous"
        now = datetime.now()
        self.seen[sid] = [t for t in self.seen[sid] if (now - t).total_seconds() < 60]
        if len(self.seen[sid]) >= self.max:
            raise Exception(f"Rate limit exceeded ({self.max}/min) for session {sid[:8]}")
        self.seen[sid].append(now)
        return await call_next(context)


class ValidationMiddleware(Middleware):
    """Simple validation for echo length."""

    async def on_call_tool(self, context, call_next):
        if context.message.name == "echo":
            msg = (context.message.arguments or {}).get("message", "")
            if len(msg) > 200:
                raise ValueError("message too long")
        return await call_next(context)


server = MCPServer(
    name="Middleware Demo Server",
    version="1.0.0",
    instructions="Minimal middleware demo",
    middleware=[
        LoggingMiddleware(),
        AuthenticationMiddleware(),
        RateLimitingMiddleware(max_requests_per_minute=10),
        ValidationMiddleware(),
        ConnectionGuard(),
    ],
    debug=True,
    pretty_print_jsonrpc=True,
)


@server.tool()
def echo(message: str) -> str:
    """Echo back a message."""
    return f"Echo: {message}"


@server.tool()
def session_id() -> dict[str, Any]:
    """Return current session ID (None on stdio)."""
    sid = server._get_session_id_from_request()
    return {
        "session_id": sid,
        "session_id_short": sid[:8] if sid else None,
        "is_anonymous": sid is None,
        "note": "From mcp-session-id header",
    }


@server.resource(
    uri="info://middleware",
    name="middleware_info",
    title="Middleware Info",
    mime_type="text/plain",
)
def middleware_info() -> str:
    """List active middleware."""
    return f"""Active Middleware:
1. LoggingMiddleware
2. AuthenticationMiddleware
3. RateLimitingMiddleware
4. ValidationMiddleware

Generated at: {datetime.now().isoformat()}
"""


@server.resource(
    uri="data://config",
    name="config",
    title="Server Configuration",
    mime_type="application/json",
)
def get_config() -> str:
    """Server configuration."""
    return """{
    "server": "Middleware Demo",
    "version": "1.0.0",
    "features": ["logging", "auth", "rate-limit", "validation"]
}"""


@server.prompt(name="help")
def help_prompt() -> str:
    """Help prompt."""
    return """# Middleware Demo Server

Middleware:
- Logging (request + tools)
- Auth (x-api-key)
- Rate limiting (per session)
- Validation (echo length)

Tools:
- echo(message)
- session_id()

Resources:
- info://middleware
- data://config
"""


if __name__ == "__main__":
    server.run(transport="streamable-http", port=8001)
