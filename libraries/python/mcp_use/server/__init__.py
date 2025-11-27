from mcp.server.fastmcp import Context

from .router import MCPRouter
from .server import MCPServer

# Alias for backward compatibility
FastMCP = MCPServer

__all__ = ["MCPServer", "MCPRouter", "FastMCP", "Context"]
