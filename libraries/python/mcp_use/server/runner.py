"""Server runner for different transport types."""

import sys
from functools import partial
from typing import TYPE_CHECKING, Literal

import anyio
import uvicorn

from mcp_use.server.logging import get_logging_config
from mcp_use.server.startup import display_startup_info

if TYPE_CHECKING:
    from mcp_use.server.server import MCPServer

from mcp_use.server.signals import setup_signal_handlers


class ServerRunner:
    """Handles running the server with different transport types."""

    def __init__(self, server: "MCPServer"):
        self.server = server

    async def run_streamable_http_async(self, host: str = "127.0.0.1", port: int = 8000, reload: bool = False) -> None:
        """Run the server using StreamableHTTP transport."""
        starlette_app = self.server.streamable_http_app()

        # Display startup information
        await display_startup_info(self.server, host, port, self.server._start_time)

        config = uvicorn.Config(
            starlette_app,
            host=host,
            port=port,
            log_level=self.server.settings.log_level.lower(),
            reload=reload,
            log_config=get_logging_config(
                debug_level=self.server.debug_level,
                show_inspector_logs=self.server.show_inspector_logs,
                inspector_path=self.server.inspector_path or "/inspector",
            ),
            timeout_graceful_shutdown=0,  # Disable graceful shutdown
        )

        server = uvicorn.Server(config)

        # Set up signal handlers before starting server
        setup_signal_handlers()

        await server.serve()

    def run(
        self,
        transport: Literal["stdio", "streamable-http"] = "stdio",
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
            debug: Whether to enable debug mode
        """
        TRANSPORTS = Literal["stdio", "streamable-http"]
        if transport not in TRANSPORTS.__args__:  # type: ignore
            raise ValueError(f"Unknown transport: {transport}")

        try:
            match transport:
                case "stdio":
                    anyio.run(self.server.run_stdio_async)
                case "streamable-http":
                    if debug and not self.server.debug:
                        self.server._add_dev_routes()
                        self.server.app = self.server.streamable_http_app()
                    anyio.run(partial(self.run_streamable_http_async, host=host, port=port, reload=reload))
        except KeyboardInterrupt:
            print("\n⏹  Shutting down gracefully...", file=sys.stderr)
            sys.exit(0)
