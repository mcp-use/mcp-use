from .auth import AccessToken, AuthMiddleware, BearerAuthProvider, get_access_token, require_auth
from .context import Context
from .middleware import Middleware, TelemetryMiddleware
from .router import MCPRouter
from .server import MCPServer

# Alias for backward compatibility
FastMCP = MCPServer

__all__ = [
    "MCPServer",
    "MCPRouter",
    "FastMCP",
    "Context",
    "Middleware",
    "TelemetryMiddleware",
    # Auth exports
    "BearerAuthProvider",
    "AccessToken",
    "AuthMiddleware",
    "get_access_token",
    "require_auth",
]
