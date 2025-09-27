import logging
import os

from mcp.server.fastmcp import FastMCP
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse

from mcp_use.server.logging import MCP_LOGGING_CONFIG, MCPEnhancerMiddleware
from mcp_use.server.openmcp import get_openmcp_json


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

        # Use the logging config from the logging module

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
