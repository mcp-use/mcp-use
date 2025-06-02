"""
HTTP connector for MCP implementations.

This module provides a connector for communicating with MCP implementations
through HTTP APIs with SSE for transport.
"""

from datetime import timedelta

from mcp import ClientSession, McpError

from ..logging import logger
from ..task_managers import ConnectionManager, SseConnectionManager, StreamableHttpConnectionManager
from .base import BaseConnector


class HttpConnector(BaseConnector):
    """Connector for MCP implementations using HTTP transport with SSE or streamable HTTP.

    This connector uses HTTP/SSE or streamable HTTP to communicate with remote MCP implementations,
    using a connection manager to handle the proper lifecycle management.
    """

    def __init__(
        self,
        base_url: str,
        auth_token: str | None = None,
        headers: dict[str, str] | None = None,
        timeout: float = 5,
        sse_read_timeout: float = 60 * 5,
    ):
        """Initialize a new HTTP connector.

        Args:
            base_url: The base URL of the MCP HTTP API.
            auth_token: Optional authentication token.
            headers: Optional additional headers.
            timeout: Timeout for HTTP operations in seconds.
            sse_read_timeout: Timeout for SSE read operations in seconds.
        """
        super().__init__()
        self.base_url = base_url.rstrip("/")
        self.auth_token = auth_token
        self.headers = headers or {}
        if auth_token:
            self.headers["Authorization"] = f"Bearer {auth_token}"
        self.timeout = timeout
        self.sse_read_timeout = sse_read_timeout

    async def _setup_client(self, connection_manager: ConnectionManager) -> None:
        """Set up the client session with the provided connection manager."""

        self._connection_manager = connection_manager
        read_stream, write_stream = await self._connection_manager.start()
        self.client = ClientSession(read_stream, write_stream, sampling_callback=None)
        await self.client.__aenter__()

    async def connect(self) -> None:
        """Establish a connection to the MCP implementation."""
        if self._connected:
            logger.debug("Already connected to MCP implementation")
            return

        transport = "streamable HTTP"
        logger.debug(
            f"Connecting to MCP implementation via {transport}: {self.base_url}",
        )
        try:
            # Attempt to set up the client with streamable HTTP and send a single ping,
            # if there are any issues with the ping, fall back to SSE.
            await self._setup_client(
                StreamableHttpConnectionManager(
                    self.base_url, self.headers, self.timeout, self.sse_read_timeout
                )
            )
            try:
                # Temporarily set a read timeout so the test ping doesn't block indefinitely
                self.client._session_read_timeout_seconds = timedelta(seconds=self.timeout)
                await self.client.send_ping()
                self.client._session_read_timeout_seconds = None
            except McpError as e:
                logger.warning(f"Streamable HTTP connection failed, falling back to SSE: {e}")
                transport = "SSE"
                await self._setup_client(
                    SseConnectionManager(
                        self.base_url, self.headers, self.timeout, self.sse_read_timeout
                    )
                )

            # Mark as connected
            self._connected = True
            logger.debug(
                f"Successfully connected to MCP implementation via {transport}: {self.base_url}"
            )

        except Exception as e:
            logger.error(f"Failed to connect to MCP implementation via {transport}: {e}")

            # Clean up any resources if connection failed
            await self._cleanup_resources()

            # Re-raise the original exception
            raise
