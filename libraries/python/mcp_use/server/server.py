import os
import time

from mcp.server.fastmcp import FastMCP

from mcp_use.server.inspector import _inspector_index, _inspector_static
from mcp_use.server.logging import MCPLoggingMiddleware
from mcp_use.server.routes import docs_ui, openmcp_json
from mcp_use.server.runner import ServerRunner
from mcp_use.server.signals import setup_signal_handlers


class MCPServer(FastMCP):
    """Main MCP Server class with integrated inspector and development tools."""

    def __init__(
        self,
        name: str,
        version: str | None = None,
        instructions: str | None = None,
        debug: bool = False,
        mcp_path: str | None = "/mcp",
        docs_path: str | None = "/docs",
        inspector_path: str | None = "/inspector",
        openmcp_path: str | None = "/openmcp.json",
    ):
        self._start_time = time.time()
        super().__init__(name=name or "mcp-use server", instructions=instructions)

        if version:
            self._mcp_server.version = version

        # Set debug level: DEBUG env var takes precedence, then debug parameter
        env_debug_level = self._parse_debug_level()
        if env_debug_level > 0:
            # Environment variable overrides parameter
            self.debug_level = env_debug_level
        else:
            # Use debug parameter (0 or 1)
            self.debug_level = 1 if debug else 0

        # Set route paths
        self.mcp_path = mcp_path
        self.docs_path = docs_path
        self.inspector_path = inspector_path
        self.openmcp_path = openmcp_path

        # Add dev routes only in DEBUG=1 and above
        if self.debug_level >= 1:
            self._add_dev_routes()

        self.app = self.streamable_http_app()

        # Set up signal handlers for immediate shutdown
        setup_signal_handlers()

    def _parse_debug_level(self) -> int:
        """Parse DEBUG environment variable to get debug level.

        Returns:
            0: Production mode (clean logs only)
            1: Debug mode (clean logs + dev routes)
            2: Full debug mode (clean logs + dev routes + JSON-RPC logging)
        """
        debug_env = os.environ.get("DEBUG", "0")
        try:
            level = int(debug_env)
            return max(0, min(2, level))  # Clamp between 0-2
        except ValueError:
            # Handle string values
            if debug_env.lower() in ("1", "true", "yes"):
                return 1
            elif debug_env.lower() in ("2", "full", "verbose"):
                return 2
            else:
                return 0

    def _add_dev_routes(self):
        """Add development routes for debugging and inspection."""

        # OpenMCP configuration
        async def openmcp_handler(request):
            return await openmcp_json(request, self)

        self.custom_route(self.openmcp_path, methods=["GET"])(openmcp_handler)

        # Documentation UI
        self.custom_route(self.docs_path, methods=["GET"])(docs_ui)

        # Inspector routes
        self.custom_route(self.inspector_path, methods=["GET"])(_inspector_index)
        self.custom_route(f"{self.inspector_path}/{{path:path}}", methods=["GET"])(_inspector_static)

    def streamable_http_app(self):
        """Override to add our custom middleware."""
        app = super().streamable_http_app()

        # Add MCP logging middleware
        app.add_middleware(MCPLoggingMiddleware, debug_level=self.debug_level, mcp_path=self.mcp_path)

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
