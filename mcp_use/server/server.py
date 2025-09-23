import os

import click
import uvicorn
from mcp.server.fastmcp import FastMCP
from mcp.server.lowlevel.server import NotificationOptions
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse


class Server(FastMCP):
    def __init__(self, name: str, version: str | None = None, instructions: str | None = None, dev_mode: bool = False):
        super().__init__(name=name, instructions=instructions)
        if version:
            self._mcp_server.version = version

        self.dev_mode = dev_mode
        if self.dev_mode:
            self._add_dev_routes()

        self.app = self.streamable_http_app()

        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    def _add_dev_routes(self):
        self.custom_route("/openmcp.json", methods=["GET"])(self._openmcp_json)
        self.custom_route("/docs", methods=["GET"])(self._docs_ui)

    def _docs_ui(self, request: Request):
        template_path = os.path.join(os.path.dirname(__file__), "templates", "docs.html")
        with open(template_path) as f:
            return HTMLResponse(f.read())

    async def _openmcp_json(self, request: Request):
        tools = await self.list_tools()
        resources = await self.list_resources()
        capabilities = self._mcp_server.get_capabilities(NotificationOptions(), experimental_capabilities={})
        prompts = await self.list_prompts()

        server_description = {
            "openmcp": "1.0",
            "info": {
                "title": self.name,
                "version": self._mcp_server.version,
                "description": self.instructions,
            },
            "capabilities": capabilities.model_dump(),
            "tools": [tool.model_dump() for tool in tools],
            "resources": [resource.model_dump() for resource in resources],
            "prompts": [prompt.model_dump() for prompt in prompts],
        }
        return JSONResponse(server_description)

    def run(self, host: str = "127.0.0.1", port: int = 8000, reload: bool = False):
        # This is a simplified run method for direct execution.
        # For reload, the CLI is now the recommended approach.

        click.echo("🚀 Starting mcp-use server...")
        click.echo("│")
        if self.dev_mode:
            click.echo(f"├─ � Docs: {click.style(f'http://{host}:{port}/docs', fg='cyan')}")
            click.echo(f"├─ 📖 openmcp.json: {click.style(f'http://{host}:{port}/openmcp.json', fg='cyan')}")
        click.echo(f"└─ 🔌 Server URL: {click.style(f'http://{host}:{port}/mcp', fg='cyan')}")
        click.echo()

        uvicorn.run(self.app, host=host, port=port, reload=reload)
