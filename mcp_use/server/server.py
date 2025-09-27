import logging
import os

import click
from mcp.server.fastmcp import FastMCP
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse

from mcp_use.server.logging import MCP_LOGGING_CONFIG, MCPEnhancerMiddleware
from mcp_use.server.openmcp import get_openmcp_json
from mcp_use.server.utils import estimate_tokens


async def display_startup_info(server: "MCPServer", host: str, port: int) -> None:
    """Display comprehensive startup information for the MCP server."""
    # Gather server information
    tools = await server.list_tools()
    resources = await server.list_resources()
    prompts = await server.list_prompts()

    # Calculate token estimates
    tools_tokens = sum(estimate_tokens(tool.model_dump_json()) for tool in tools)
    resources_tokens = sum(estimate_tokens(resource.model_dump_json()) for resource in resources)
    prompts_tokens = sum(estimate_tokens(prompt.model_dump_json()) for prompt in prompts)
    total_tokens = tools_tokens + resources_tokens + prompts_tokens

    # Display startup information
    click.echo(click.style(f"MCP Server: {server.name}", fg="cyan", bold=True))
    click.echo(
        f"Protocol: {click.style('2025-06-18', fg='green')} | Tools: {click.style(str(len(tools)), fg='yellow')} |"
        f" Resources: {click.style(str(len(resources)), fg='yellow')} |"
        f" Prompts: {click.style(str(len(prompts)), fg='yellow')} |"
        f" Tokens: {click.style(str(total_tokens), fg='magenta')}"
    )
    if server.dev_mode:
        click.echo(f"Docs:    {click.style(f'http://{host}:{port}/docs', fg='cyan')}")
        click.echo(f"OpenMCP: {click.style(f'http://{host}:{port}/openmcp.json', fg='cyan')}")
    click.echo(f"Server:  {click.style(f'http://{host}:{port}/mcp', fg='cyan')}")
    click.echo()


class MCPServer(FastMCP):
    def __init__(self, name: str, version: str | None = None, instructions: str | None = None, dev_mode: bool = False):
        super().__init__(name=name, instructions=instructions)
        if version:
            self._mcp_server.version = version

        # Logging is now handled entirely through Uvicorn's logging system

        self.dev_mode = dev_mode
        if self.dev_mode:
            self._add_dev_routes()

        self.app = self.streamable_http_app()

        logging.getLogger("mcp.server.lowlevel.server").setLevel(logging.WARNING)

    def _add_dev_routes(self):
        self.custom_route("/openmcp.json", methods=["GET"])(self._openmcp_json)
        self.custom_route("/docs", methods=["GET"])(self._docs_ui)

    def _docs_ui(self, request: Request):
        template_path = os.path.join(os.path.dirname(__file__), "templates", "docs.html")
        with open(template_path) as f:
            return HTMLResponse(f.read())

    async def _openmcp_json(self, request: Request):
        return await get_openmcp_json(self)

    def streamable_http_app(self):
        """Override to add our custom middleware."""
        app = super().streamable_http_app()

        # Add CORS middleware
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        # Add middleware to extract MCP method info
        app.add_middleware(MCPEnhancerMiddleware)

        return app

    async def run_sse_async(self, mount_path: str | None = None, reload: bool = False) -> None:
        """Run the server using SSE transport."""
        import uvicorn

        starlette_app = self.sse_app(mount_path)

        config = uvicorn.Config(
            starlette_app,
            host=self.settings.host,
            port=self.settings.port,
            log_level=self.settings.log_level.lower(),
            reload=reload,
        )
        server = uvicorn.Server(config)
        await server.serve()

    async def run_streamable_http_async(self, reload: bool = False) -> None:
        """Run the server using StreamableHTTP transport."""
        import uvicorn

        starlette_app = self.streamable_http_app()

        # Display startup information
        await display_startup_info(self, self.settings.host, self.settings.port)

        config = uvicorn.Config(
            starlette_app,
            host=self.settings.host,
            port=self.settings.port,
            log_level=self.settings.log_level.lower(),
            reload=reload,
            log_config=MCP_LOGGING_CONFIG,
        )
        server = uvicorn.Server(config)
        await server.serve()
