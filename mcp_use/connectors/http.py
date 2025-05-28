"""
HTTP connector for MCP implementations.

This module provides a connector for communicating with MCP implementations
through HTTP APIs with SSE for transport.
"""

from mcp import ClientSession

from ..logging import logger
from ..task_managers import SseConnectionManager, StreamableHttpConnectionManager
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
        use_streamable_http: bool = False,
    ):
        """Initialize a new HTTP connector.

        Args:
            base_url: The base URL of the MCP HTTP API.
            auth_token: Optional authentication token.
            headers: Optional additional headers.
            timeout: Timeout for HTTP operations in seconds.
            sse_read_timeout: Timeout for SSE read operations in seconds.
            use_streamable_http: Whether to use streamable HTTP instead of SSE.
        """
        super().__init__()
        self.base_url = base_url.rstrip("/")
        self.auth_token = auth_token
        self.headers = headers or {}
        if auth_token:
            self.headers["Authorization"] = f"Bearer {auth_token}"
        self.timeout = timeout
        self.sse_read_timeout = sse_read_timeout
        self.use_streamable_http = use_streamable_http

    async def connect(self) -> None:
        """Establish a connection to the MCP implementation."""
        if self._connected:
            logger.debug("Already connected to MCP implementation")
            return

        transport = "streamable HTTP" if self.use_streamable_http else "HTTP/SSE"
        logger.debug(
            f"Connecting to MCP implementation via {transport}: {self.base_url}",
        )
        try:
            # Create and start the connection manager
            self._connection_manager = (
                SseConnectionManager(
                    self.base_url, self.headers, self.timeout, self.sse_read_timeout
                )
                if not self.use_streamable_http
                else StreamableHttpConnectionManager(
                    self.base_url, self.headers, self.timeout, self.sse_read_timeout
                )
            )

            read_stream, write_stream = await self._connection_manager.start()

            # Create the client session
            self.client = ClientSession(read_stream, write_stream, sampling_callback=None)
            await self.client.__aenter__()

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
