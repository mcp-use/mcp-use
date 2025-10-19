import time

from mcp.server.fastmcp import FastMCP

from mcp_use.server.inspector import _inspector_index, _inspector_static
from mcp_use.server.logging import MCPLoggingMiddleware
from mcp_use.server.routes import docs_ui, openmcp_json
from mcp_use.server.runner import ServerRunner
from mcp_use.server.signals import setup_signal_handlers


class MCPServer(FastMCP):
    """Main MCP Server class with integrated inspector and development tools."""

    def __init__(self, name: str, version: str | None = None, instructions: str | None = None, debug: bool = False):
        self._start_time = time.time()
        super().__init__(name=name or "mcp-use server", instructions=instructions)

        if version:
            self._mcp_server.version = version

        self.debug = debug
        if self.debug:
            self._add_dev_routes()

        self.app = self.streamable_http_app()

        # Set up signal handlers for immediate shutdown
        setup_signal_handlers()

    def _add_dev_routes(self):
        """Add development routes for debugging and inspection."""

        # OpenMCP configuration
        async def openmcp_handler(request):
            return await openmcp_json(request, self)

        self.custom_route("/openmcp.json", methods=["GET"])(openmcp_handler)

        # Documentation UI
        self.custom_route("/docs", methods=["GET"])(docs_ui)

        # Inspector routes
        self.custom_route("/inspector", methods=["GET"])(_inspector_index)
        self.custom_route("/inspector/{path:path}", methods=["GET"])(_inspector_static)

    def streamable_http_app(self):
        """Override to add our custom middleware."""
        app = super().streamable_http_app()

        # Add middleware for structured logging
        app.add_middleware(MCPLoggingMiddleware)

        return app

    def run(
        self,
        transport: str = "stdio",
        host: str = "127.0.0.1",
        port: int = 8000,
        reload: bool = False,
        debug: bool = False,
    ) -> None:
        """Run the MCP server.

        Args:
            transport: Transport protocol to use ("stdio" or "streamable-http")
            host: Host to bind to
            port: Port to bind to
            reload: Whether to enable auto-reload
            debug: Whether to enable debug mode (adds /docs and /openmcp.json endpoints)
        """
        runner = ServerRunner(self)
        runner.run(transport=transport, host=host, port=port, reload=reload, debug=debug)
