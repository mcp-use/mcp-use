import os
import time
from functools import partial
from typing import Literal

import anyio
from mcp.server.fastmcp import FastMCP
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse

from mcp_use.server.cli import display_startup_info
from mcp_use.server.logging import MCP_LOGGING_CONFIG, MCPEnhancerMiddleware
from mcp_use.server.openmcp import get_openmcp_json


class MCPServer(FastMCP):
    def __init__(self, name: str, version: str | None = None, instructions: str | None = None, debug: bool = False):
        self._start_time = time.time()  # Track startup time
        super().__init__(name=name, instructions=instructions)
        if version:
            self._mcp_server.version = version

        # Logging is now handled entirely through Uvicorn's logging system

        self.debug = debug
        if self.debug:
            self._add_dev_routes()

        self.app = self.streamable_http_app()

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

    async def run_streamable_http_async(self, host: str = "127.0.0.1", port: int = 8000, reload: bool = False) -> None:
        """Run the server using StreamableHTTP transport."""
        import uvicorn

        starlette_app = self.streamable_http_app()

        # Display startup information (show localhost for primary URL)
        await display_startup_info(self, host, port, self._start_time)

        config = uvicorn.Config(
            starlette_app,
            host=host,
            port=port,
            log_level=self.settings.log_level.lower(),
            reload=reload,
            log_config=MCP_LOGGING_CONFIG,
        )
        server = uvicorn.Server(config)
        await server.serve()

    def run(
        self,
        transport: Literal["stdio", "streamable-http"] = "stdio",
        host: str = "127.0.0.1",
        port: int = 8000,
        reload: bool = False,
        debug: bool = False,
    ) -> None:
        """Run the FastMCP server. Note this is a synchronous function.

        Args:
            transport: Transport protocol to use ("stdio", "sse", or "streamable-http")
            host: Host to bind to
            port: Port to bind to
            mount_path: Optional mount path for SSE transport
            reload: Whether to enable auto-reload
        """
        TRANSPORTS = Literal["stdio", "sse", "streamable-http"]
        if transport not in TRANSPORTS.__args__:  # type: ignore
            raise ValueError(f"Unknown transport: {transport}")

        match transport:
            case "stdio":
                anyio.run(self.run_stdio_async)
            case "streamable-http":
                if debug:
                    self._add_dev_routes()
                anyio.run(partial(self.run_streamable_http_async, host=host, port=port, reload=reload))
