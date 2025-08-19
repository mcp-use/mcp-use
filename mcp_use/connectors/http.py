"""
HTTP connector for MCP implementations.

This module provides a connector for communicating with MCP implementations
through HTTP APIs with SSE or Streamable HTTP for transport.
"""

from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.session import ElicitationFnT, LoggingFnT, MessageHandlerFnT, SamplingFnT

from mcp_use.auth.oauth import OAuthClientProvider

from ..auth import BearerAuth, OAuth
from ..exceptions import OAuthAuthenticationError, OAuthDiscoveryError
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
        headers: dict[str, str] | None = None,
        timeout: float = 5,
        sse_read_timeout: float = 60 * 5,
        auth: str | dict[str, Any] | httpx.Auth | None = None,
        sampling_callback: SamplingFnT | None = None,
        elicitation_callback: ElicitationFnT | None = None,
        message_handler: MessageHandlerFnT | None = None,
        logging_callback: LoggingFnT | None = None,
    ):
        """Initialize a new HTTP connector.

        Args:
            base_url: The base URL of the MCP HTTP API.
            headers: Optional additional headers.
            timeout: Timeout for HTTP operations in seconds.
            sse_read_timeout: Timeout for SSE read operations in seconds.
            auth: Authentication method - can be:
                - A string token: Use Bearer token authentication
                - A dict with OAuth config: {"client_id": "...", "client_secret": "...", "scope": "..."}
                - An httpx.Auth object: Use custom authentication
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
        self.headers = headers or {}
        self.timeout = timeout
        self.sse_read_timeout = sse_read_timeout
        self._auth: httpx.Auth | None = None
        self._oauth: OAuth | None = None

        # Handle authentication
        if auth is not None:
            self._set_auth(auth)

    def _set_auth(self, auth: str | dict[str, Any] | httpx.Auth) -> None:
        """Set authentication method.

        Args:
            auth: Authentication method - can be:
                - A string token: Use Bearer token authentication
                - A dict with OAuth config: {"client_id": "...", "client_secret": "...", "scope": "..."}
                - An httpx.Auth object: Use custom authentication
        """
        self._oauth_config = {}
        if isinstance(auth, str):
            # Treat as bearer token
            self._auth = BearerAuth(token=auth)
            self.headers["Authorization"] = f"Bearer {auth}"
        elif isinstance(auth, dict):
            # Check if this is an OAuth provider configuration
            if "oauth_provider" in auth:
                oauth_provider = auth["oauth_provider"]
                if isinstance(oauth_provider, dict):
                    oauth_provider = OAuthClientProvider(**oauth_provider)
                self._oauth = OAuth(
                    self.base_url,
                    client_id=auth.get("client_id"),
                    client_secret=auth.get("client_secret"),
                    scope=auth.get("scope"),
                    oauth_provider=oauth_provider,
                )
                self._oauth_config = auth
            else:
                self._oauth = OAuth(
                    self.base_url,
                    client_id=auth.get("client_id"),
                    client_secret=auth.get("client_secret"),
                    scope=auth.get("scope"),
                )
                self._oauth_config = auth
        elif isinstance(auth, httpx.Auth):
            self._auth = auth
        else:
            raise ValueError(f"Invalid auth type: {type(auth)}")

    async def connect(self) -> None:
        """Establish a connection to the MCP implementation."""
        if self._connected:
            logger.debug("Already connected to MCP implementation")
            return

        # Handle OAuth if needed
        if self._oauth:
            try:
                # Create a temporary client for OAuth metadata discovery
                async with httpx.AsyncClient() as client:
                    bearer_auth = await self._oauth.initialize(client)
                    if not bearer_auth:
                        # Need to perform OAuth flow
                        logger.info("OAuth authentication required")
                        bearer_auth = await self._oauth.authenticate()

                    # Update auth and headers
                    self._auth = bearer_auth
                    self.headers["Authorization"] = f"Bearer {bearer_auth.token.get_secret_value()}"
            except OAuthDiscoveryError:
                # OAuth discovery failed - it means server doesn't support OAuth default urls
                logger.debug("OAuth discovery failed, continuing without initialization.")
                self._oauth = None
                self._auth = None
            except OAuthAuthenticationError as e:
                logger.error(f"OAuth initialization failed: {e}")
                raise

        # Try streamable HTTP first (new transport), fall back to SSE (old transport)
        # This implements backwards compatibility per MCP specification
        self.transport_type = None
        connection_manager = None

        try:
            # First, try the new streamable HTTP transport
            logger.debug(f"Attempting streamable HTTP connection to: {self.base_url}")
            connection_manager = StreamableHttpConnectionManager(
                self.base_url, self.headers, self.timeout, self.sse_read_timeout, auth=self._auth
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

            except Exception as exception:
                # Clean up the test client
                try:
                    await test_client.__aexit__(None, None, None)
                except Exception:
                    pass

                if isinstance(exception, httpx.HTTPStatusError):
                    if exception.response.status_code in [401, 403, 407]:  # Authentication error using status
                        # Server requires authentication but OAuth discovery failed
                        raise OAuthAuthenticationError(
                            f"Server requires authentication (HTTP {exception.response.status_code}) "
                            "but OAuth discovery failed. Please provide OAuth configuration manually."
                        ) from exception
                else:
                    raise exception

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
                        self.base_url, self.headers, self.timeout, self.sse_read_timeout, auth=self._auth
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
                    if isinstance(sse_error, httpx.HTTPStatusError):
                        if sse_error.response.status_code in [401, 403, 407]:
                            raise OAuthAuthenticationError(
                                f"Server requires authentication (HTTP {sse_error.response.status_code}) "
                                "but OAuth discovery failed. Please provide OAuth configuration manually."
                            ) from sse_error
                    else:
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
