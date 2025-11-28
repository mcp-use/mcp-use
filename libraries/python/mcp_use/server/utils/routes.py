"""Route handlers for the MCP server."""

import os

from starlette.requests import Request
from starlette.responses import HTMLResponse

from mcp_use.server.utils.openmcp import get_openmcp_json


async def docs_ui(request: Request) -> HTMLResponse:
    """Serve the docs UI."""
    template_path = os.path.join(os.path.dirname(__file__), "templates", "docs.html")
    with open(template_path) as f:
        return HTMLResponse(f.read())


async def openmcp_json(request: Request, server):
    """Serve the OpenMCP JSON configuration."""
    return await get_openmcp_json(server)
