"""A stdio MCP server for the stdio tests, configured only through ``MANUFACT_ANALYTICS_*``.

It exits when the client closes stdin; the events reach the ingest through the
interpreter-exit flush.
"""

from __future__ import annotations

from importlib import metadata

import mcp_use_analytics

if int(metadata.version("mcp").split(".")[0]) == 1:
    from mcp.server.fastmcp import FastMCP as Server
else:
    from mcp.server.mcpserver import MCPServer as Server

mcp = Server("analytics-test")


@mcp.tool()
def add(a: int, b: int) -> int:
    return a + b


mcp_use_analytics.instrument(mcp)

if __name__ == "__main__":
    mcp.run()
