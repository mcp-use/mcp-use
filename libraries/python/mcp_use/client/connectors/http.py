"""
HTTP connector for MCP implementations.

This module provides a connector for communicating with MCP implementations
through HTTP APIs with SSE or Streamable HTTP for transport.
"""

from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.session import ElicitationFnT, LoggingFnT, MessageHandlerFnT, SamplingFnT
from mcp.shared.exceptions import McpError

from mcp_use.client.auth.oauth import BearerAuth, OAuth, OAuthClientProvider
from mcp_use.client.connectors.base import BaseConnector
from mcp_use.client.exceptions import OAuthAuthenticationError, OAuthDiscoveryError
from mcp_use.client.middleware import CallbackClientSession, Middleware
from mcp_use.client.task_managers import SseConnectionManager, StreamableHttpConnectionManager
from mcp_use.logging import logger


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
        middleware: list[Middleware] | None = None,
        verify: bool | None = True,
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
            middleware=middleware,
        )
        self.base_url = base_url.rstrip("/")
        self.headers = headers or {}
        self.timeout = timeout
        self.sse_read_timeout = sse_read_timeout
        self._auth: httpx.Auth | None = None
        self._oauth: OAuth | None = None
        self.verify = verify

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
                    scope=auth.get("scope"),
                    client_id=auth.get("client_id"),
                    client_secret=auth.get("client_secret"),
                    callback_port=auth.get("callback_port"),
                    oauth_provider=oauth_provider,
                )
                self._oauth_config = auth
            else:
                self._oauth = OAuth(
                    self.base_url,
                    scope=auth.get("scope"),
                    client_id=auth.get("client_id"),
                    client_secret=auth.get("client_secret"),
                    callback_port=auth.get("callback_port"),
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
                async with httpx.AsyncClient(verify=self.verify) as client:
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

        # Create custom httpx factory
        httpx_client_factory = self._build_httpx_factory()

        try:
            # First, try the new streamable HTTP transport
            logger.debug(f"Attempting streamable HTTP connection to: {self.base_url}")
            connection_manager = StreamableHttpConnectionManager(
                self.base_url,
                self.headers,
                self.timeout,
                self.sse_read_timeout,
                auth=self._auth,
                httpx_client_factory=httpx_client_factory,
            )

            # Test if this is a streamable HTTP server by attempting initialization
            read_stream, write_stream = await connection_manager.start()

            # Test if this actually works by trying to create a client session and initialize it
            raw_test_client = ClientSession(
                read_stream,
                write_stream,
                sampling_callback=self.sampling_callback,
                elicitation_callback=self.elicitation_callback,
                list_roots_callback=self.list_roots_callback,
                message_handler=self._internal_message_handler,
                logging_callback=self.logging_callback,
                client_info=self.client_info,
            )
            await raw_test_client.__aenter__()

            # Wrap test client with middleware temporarily for testing
            test_client = CallbackClientSession(raw_test_client, self.public_identifier, self.middleware_manager)

            try:
                # Try to initialize - this is where streamable HTTP vs SSE difference should show up
                result = await test_client.initialize()
                logger.debug(f"Streamable HTTP initialization result: {result}")

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

            # Only McpError is raised from client's initialization because
            # exceptions are handled internally.
            except McpError as mcp_error:
                logger.error("MCP protocol error during initialization: %s", mcp_error.error)
                # Clean up the test client
                try:
                    await raw_test_client.__aexit__(None, None, None)
                except Exception:
                    pass
                raise mcp_error

            except Exception as init_error:
                # This catches non-McpError exceptions, like a direct httpx timeout
                # but in the most cases this won't happen. It's for safety.
                try:
                    await raw_test_client.__aexit__(None, None, None)
                except Exception:
                    pass
                raise init_error

        # Exception from the inner try is propagated here and in
        # the most cases is an McpError, so checking instances is useless
        except Exception as streamable_error:
            logger.debug(f"Streamable HTTP failed: {streamable_error}")

            # Clean up the failed streamable HTTP connection manager
            if connection_manager:
                try:
                    await connection_manager.close()
                except Exception:
                    pass

            # It doesn't make sense to check error types. Because client
            # always return a McpError, if he can't reach the server
            # because it's offline, or if it has an auth problem.
            should_fallback = True

            if should_fallback:
                try:
                    # Fall back to the old SSE transport
                    logger.debug(f"Attempting SSE fallback connection to: {self.base_url}")
                    connection_manager = SseConnectionManager(
                        self.base_url,
                        self.headers,
                        self.timeout,
                        self.sse_read_timeout,
                        auth=self._auth,
                        httpx_client_factory=httpx_client_factory,
                    )

                    read_stream, write_stream = await connection_manager.start()

                    # Create the client session for SSE
                    raw_client_session = ClientSession(
                        read_stream,
                        write_stream,
                        sampling_callback=self.sampling_callback,
                        elicitation_callback=self.elicitation_callback,
                        list_roots_callback=self.list_roots_callback,
                        message_handler=self._internal_message_handler,
                        logging_callback=self.logging_callback,
                        client_info=self.client_info,
                    )
                    await raw_client_session.__aenter__()

                    # Wrap with middleware
                    self.client_session = CallbackClientSession(
                        raw_client_session, self.public_identifier, self.middleware_manager
                    )
                    self.transport_type = "SSE"

                except* Exception as sse_error:
                    # Get the exception from the ExceptionGroup, and here we will get the correct type.
                    sse_error = sse_error.exceptions[0]
                    if isinstance(sse_error, httpx.HTTPStatusError) and sse_error.response.status_code in [
                        401,
                        403,
                        407,
                    ]:
                        raise OAuthAuthenticationError(
                            f"Server requires authentication (HTTP {sse_error.response.status_code}) "
                            "but auth failed. Please provide auth configuration manually."
                        ) from sse_error
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

    def _build_httpx_factory(self):
        verify = self.verify

        def factory(
            headers: dict[str, str] | None = None, timeout: httpx.Timeout | None = None, auth: httpx.Auth | None = None
        ) -> httpx.AsyncClient:
            return httpx.AsyncClient(
                headers=headers,
                timeout=timeout or httpx.Timeout(30.0),
                auth=auth,
                verify=verify,
                follow_redirects=True,
            )

        return factory

    @property
    def public_identifier(self) -> str:
        """Get the identifier for the connector."""
        transport_type = getattr(self, "transport_type", "http")
        return f"{transport_type}:{self.base_url}"
