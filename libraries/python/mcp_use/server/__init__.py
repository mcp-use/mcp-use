from .context import Context
from .dependencies import Depends
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
    "Depends",
    "Middleware",
    "TelemetryMiddleware",
]
