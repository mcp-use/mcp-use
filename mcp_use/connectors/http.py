"""
HTTP connector for MCP implementations.

This module provides a connector for communicating with MCP implementations
through HTTP APIs with SSE or Streamable HTTP for transport.
"""

import httpx
from mcp import ClientSession
from mcp.client.session import ElicitationFnT, LoggingFnT, MessageHandlerFnT, SamplingFnT

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
        sampling_callback: SamplingFnT | None = None,
        elicitation_callback: ElicitationFnT | None = None,
        message_handler: MessageHandlerFnT | None = None,
        logging_callback: LoggingFnT | None = None,
    ):
        """Initialize a new HTTP connector.

        Args:
            base_url: The base URL of the MCP HTTP API.
            auth_token: Optional authentication token.
            headers: Optional additional headers.
            timeout: Timeout for HTTP operations in seconds.
            sse_read_timeout: Timeout for SSE read operations in seconds.
            sampling_callback: Optional sampling callback.
            elicitation_callback: Optional elicitation callback.
        """
        super().__init__(
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
        )
        self.base_url = base_url.rstrip("/")
        self.auth_token = auth_token
        self.headers = headers or {}
        if auth_token:
            self.headers["Authorization"] = f"Bearer {auth_token}"
        self.timeout = timeout
        self.sse_read_timeout = sse_read_timeout

    async def connect(self) -> None:
        """Establish a connection to the MCP implementation."""
        if self._connected:
            logger.debug("Already connected to MCP implementation")
            return

        # Try streamable HTTP first (new transport), fall back to SSE (old transport)
        # This implements backwards compatibility per MCP specification
        self.transport_type = None
        connection_manager = None

        try:
            # First, try the new streamable HTTP transport
            logger.debug(f"Attempting streamable HTTP connection to: {self.base_url}")
            connection_manager = StreamableHttpConnectionManager(
                self.base_url, self.headers, self.timeout, self.sse_read_timeout
            )

            # Test if this is a streamable HTTP server by attempting initialization
            read_stream, write_stream = await connection_manager.start()

            # Test if this actually works by trying to create a client session and initialize it
            test_client = ClientSession(
                read_stream,
                write_stream,
                sampling_callback=self.sampling_callback,
                elicitation_callback=self.elicitation_callback,
                message_handler=self._internal_message_handler,
                logging_callback=self.logging_callback,
                client_info=self.client_info,
            )
            await test_client.__aenter__()

            try:
                # Try to initialize - this is where streamable HTTP vs SSE difference should show up
                result = await test_client.initialize()

                # If we get here, streamable HTTP works

                self.client_session = test_client
                self.transport_type = "streamable HTTP"
                self._initialized = True  # Mark as initialized since we just called initialize()

                # Populate tools, resources, and prompts since we've initialized
                server_capabilities = result.capabilities

                if server_capabilities.tools:
                    # Get available tools directly from client session
                    tools_result = await self.client_session.list_tools()
                    self._tools = tools_result.tools if tools_result else []
                else:
                    self._tools = []

                if server_capabilities.resources:
                    # Get available resources directly from client session
                    resources_result = await self.client_session.list_resources()
                    self._resources = resources_result.resources if resources_result else []
                else:
                    self._resources = []

                if server_capabilities.prompts:
                    # Get available prompts directly from client session
                    prompts_result = await self.client_session.list_prompts()
                    self._prompts = prompts_result.prompts if prompts_result else []
                else:
                    self._prompts = []

            except Exception as init_error:
                # Clean up the test client
                try:
                    await test_client.__aexit__(None, None, None)
                except Exception:
                    pass
                raise init_error

        except Exception as streamable_error:
            logger.debug(f"Streamable HTTP failed: {streamable_error}")

            # Clean up the failed streamable HTTP connection manager
            if connection_manager:
                try:
                    await connection_manager.close()
                except Exception:
                    pass

            # Check if this is a 4xx error that indicates we should try SSE fallback
            should_fallback = False
            if isinstance(streamable_error, httpx.HTTPStatusError):
                if streamable_error.response.status_code in [404, 405]:
                    should_fallback = True
            elif "405 Method Not Allowed" in str(streamable_error) or "404 Not Found" in str(streamable_error):
                should_fallback = True
            else:
                # For other errors, still try fallback but they might indicate
                # real connectivity issues
                should_fallback = True

            if should_fallback:
                try:
                    # Fall back to the old SSE transport
                    logger.debug(f"Attempting SSE fallback connection to: {self.base_url}")
                    connection_manager = SseConnectionManager(
                        self.base_url, self.headers, self.timeout, self.sse_read_timeout
                    )

                    read_stream, write_stream = await connection_manager.start()

                    # Create the client session for SSE
                    self.client_session = ClientSession(
                        read_stream,
                        write_stream,
                        sampling_callback=self.sampling_callback,
                        elicitation_callback=self.elicitation_callback,
                        message_handler=self._internal_message_handler,
                        logging_callback=self.logging_callback,
                        client_info=self.client_info,
                    )
                    await self.client_session.__aenter__()
                    self.transport_type = "SSE"

                except Exception as sse_error:
                    logger.error(
                        f"Both transport methods failed. Streamable HTTP: {streamable_error}, SSE: {sse_error}"
                    )
                    raise sse_error
            else:
                raise streamable_error

        # Store the successful connection manager and mark as connected
        self._connection_manager = connection_manager
        self._connected = True
        logger.debug(f"Successfully connected to MCP implementation via {self.transport_type}: {self.base_url}")

    @property
    def public_identifier(self) -> str:
        """Get the identifier for the connector."""
        return {"type": self.transport_type, "base_url": self.base_url}
