"""Test server with bearer token authentication."""

import argparse
from typing import get_args

from mcp_use.server import (
    AccessToken,
    BearerAuthProvider,
    MCPServer,
    get_access_token,
)
from mcp_use.server.types import TransportType

# Valid tokens for testing
VALID_TOKENS = {
    "test-token-alice": {"sub": "user-1", "email": "alice@example.com", "name": "Alice"},
    "test-token-bob": {"sub": "user-2", "email": "bob@example.com", "name": "Bob"},
    "admin-token": {
        "sub": "admin-1",
        "email": "admin@example.com",
        "name": "Admin",
        "scopes": ["admin", "read", "write"],
    },
}


class TestBearerAuthProvider(BearerAuthProvider):
    """Simple bearer auth provider for testing."""

    async def verify_token(self, token: str) -> AccessToken | None:
        if token not in VALID_TOKENS:
            return None

        user_data = VALID_TOKENS[token]
        scopes = user_data.get("scopes", [])
        claims = {k: v for k, v in user_data.items() if k != "scopes"}

        return AccessToken(token=token, claims=claims, scopes=scopes)


mcp = MCPServer(name="BearerAuthTestServer", auth=TestBearerAuthProvider())


@mcp.tool()
def public_tool() -> str:
    """A tool that works regardless of auth status."""
    token = get_access_token()
    if token:
        return f"Hello {token.claims.get('name', 'user')}!"
    return "Hello anonymous!"


@mcp.tool()
def whoami() -> dict:
    """Returns the authenticated user's info."""
    token = get_access_token()
    if not token:
        return {"authenticated": False}
    return {
        "authenticated": True,
        "email": token.claims.get("email"),
        "name": token.claims.get("name"),
        "scopes": token.scopes,
    }


@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers."""
    return a + b


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run MCP bearer auth test server.")
    parser.add_argument(
        "--transport",
        type=str,
        choices=get_args(TransportType),
        default="streamable-http",
        help="MCP transport type to use (default: streamable-http)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8082,
        help="Port to run on (default: 8082)",
    )
    args = parser.parse_args()

    print(f"Starting bearer auth test server on port {args.port}")

    if args.transport == "streamable-http":
        mcp.run(transport="streamable-http", host="127.0.0.1", port=args.port)
    elif args.transport == "sse":
        mcp.run(transport="sse", host="127.0.0.1", port=args.port)
