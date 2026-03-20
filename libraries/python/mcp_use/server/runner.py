"""Server runner for different transport types."""

import logging
import socket
import sys
from functools import partial
from typing import TYPE_CHECKING, get_args

import anyio
import uvicorn

from mcp_use.server.logging import get_logging_config
from mcp_use.server.logging.startup import display_startup_info
from mcp_use.server.types import TransportType

if TYPE_CHECKING:
    from mcp_use.server.server import MCPServer

from starlette.applications import Starlette

logger = logging.getLogger(__name__)


def _is_port_available(host: str, port: int) -> bool:
    """Check if a port is available for binding."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def _find_available_port(host: str, port: int, max_retries: int = 10) -> int:
    """Find an available port starting from the given port."""
    for i in range(max_retries):
        candidate = port + i
        if _is_port_available(host, candidate):
            return candidate
    raise RuntimeError(f"No available port found in range {port}-{port + max_retries - 1}")


class ServerRunner:
    """Handles running the server with different transport types."""

    def __init__(self, server: "MCPServer"):
        self.server = server

    async def serve_starlette_app(
        self,
        starlette_app: Starlette,
        host: str = "127.0.0.1",
        port: int = 8000,
        transport: TransportType | None = None,
        reload: bool = False,
    ) -> None:
        # Find an available port if the requested one is in use
        original_port = port
        port = _find_available_port(host, port)
        if port != original_port:
            logger.info(f"Port {original_port} is in use, using port {port} instead.")

        # Display startup information
        await display_startup_info(self.server, host, port, transport, self.server._start_time)
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
                mcp_logs_only=self.server.mcp_logs_only,
            ),
            timeout_graceful_shutdown=0,  # Disable graceful shutdown
        )
        server = uvicorn.Server(config)
        await server.serve()

    async def run_streamable_http_async(self, host: str = "127.0.0.1", port: int = 8000, reload: bool = False) -> None:
        """Run the server using StreamableHTTP transport."""
        starlette_app = self.server.streamable_http_app()
        await self.serve_starlette_app(starlette_app, host, port, "streamable-http", reload)

    async def run_sse_async(self, host: str = "127.0.0.1", port: int = 8000, reload: bool = False) -> None:
        """Run the server using SSE transport."""
        starlette_app = self.server.sse_app(self.server.mcp_path)
        await self.serve_starlette_app(starlette_app, host, port, "sse", reload)

    def run(
        self,
        transport: TransportType = "streamable-http",
        host: str = "127.0.0.1",
        port: int = 8000,
        reload: bool = False,
    ) -> None:
        """Run the MCP server.

        Args:
            transport: Transport protocol to use ("stdio", "streamable-http" or "sse")
            host: Host to bind to
            port: Port to bind to
            reload: Whether to enable auto-reload
        """

        if transport not in get_args(TransportType):
            raise ValueError(f"Unknown transport: {transport}")

        try:
            match transport:
                case "stdio":
                    anyio.run(self.server.run_stdio_async)
                case "streamable-http":
                    anyio.run(partial(self.run_streamable_http_async, host=host, port=port, reload=reload))
                case "sse":
                    logger.warning("SSE transport is not supported anymore. Use streamable-http instead.")
        except KeyboardInterrupt:
            print("\n⏹  Shutting down gracefully...", file=sys.stderr)
            sys.exit(0)
