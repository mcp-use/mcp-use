from mcp.server.fastmcp import Context

from .server import MCPServer

# Alias for backward compatibility
FastMCP = MCPServer

__all__ = ["MCPServer", "FastMCP", "Context"]
