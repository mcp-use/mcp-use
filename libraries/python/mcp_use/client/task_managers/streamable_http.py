"""
Streamable HTTP connection management for MCP implementations.

This module provides a connection manager for streamable HTTP-based MCP connections
that ensures proper task isolation and resource cleanup.
"""

from datetime import timedelta
from typing import Any

import httpx
from mcp.client.streamable_http import streamablehttp_client
from mcp.shared._httpx_utils import McpHttpClientFactory

from mcp_use.client.task_managers.base import ConnectionManager
from mcp_use.logging import logger


class StreamableHttpConnectionManager(ConnectionManager[tuple[Any, Any]]):
    """Connection manager for streamable HTTP-based MCP connections.

    This class handles the proper task isolation for HTTP streaming connections
    to prevent the "cancel scope in different task" error. It runs the http_stream_client
    in a dedicated task and manages its lifecycle.
    """

    def __init__(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout: float = 5,
        read_timeout: float = 60 * 5,
        auth: httpx.Auth | None = None,
        httpx_client_factory: McpHttpClientFactory | None = None,
    ):
        """Initialize a new streamable HTTP connection manager.

        Args:
            url: The HTTP endpoint URL
            headers: Optional HTTP headers
            timeout: Timeout for HTTP operations in seconds
            read_timeout: Timeout for HTTP read operations in seconds
            auth: Optional httpx.Auth instance for authentication
            httpx_client_factory: Custom HTTPX client factory for MCP
        """
        super().__init__()
        self.url = url
        self.headers = headers or {}
        self.timeout = timedelta(seconds=timeout)
        self.read_timeout = timedelta(seconds=read_timeout)
        self.auth = auth
        self.httpx_client_factory = httpx_client_factory
        self._http_ctx = None

    async def _establish_connection(self) -> tuple[Any, Any]:
        """Establish a streamable HTTP connection.

        Returns:
            A tuple of (read_stream, write_stream)

        Raises:
            Exception: If connection cannot be established.
        """
        # Create the context manager
        self._http_ctx = streamablehttp_client(
            url=self.url,
            headers=self.headers,
            timeout=self.timeout,
            sse_read_timeout=self.read_timeout,
            auth=self.auth,
            httpx_client_factory=self.httpx_client_factory,
        )

        # Enter the context manager. Ignoring the session id callback
        read_stream, write_stream, _ = await self._http_ctx.__aenter__()

        # Return the streams
        return (read_stream, write_stream)

    async def _close_connection(self) -> None:
        """Close the streamable HTTP connection."""

        if self._http_ctx:
            # Exit the context manager
            try:
                await self._http_ctx.__aexit__(None, None, None)
            except Exception as e:
                # Only log if it's not a normal connection termination
                logger.debug(f"Streamable HTTP context cleanup: {e}")
            finally:
                self._http_ctx = None
