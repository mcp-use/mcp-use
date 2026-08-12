"""
WebSocket connector for MCP implementations.

This module provides a connector for communicating with MCP implementations
through WebSocket connections.
"""

import time
import uuid
from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.session import ElicitationFnT, ListRootsFnT, LoggingFnT, MessageHandlerFnT, SamplingFnT
from mcp.types import Root
from pydantic import BaseModel, RootModel

from mcp_use.client.connectors.base import BaseConnector
from mcp_use.client.middleware import CallbackClientSession, Middleware, MiddlewareContext
from mcp_use.client.task_managers import WebSocketConnectionManager
from mcp_use.logging import logger


class _RawRequest(BaseModel):
    """Request model used by the backwards-compatible raw request API."""

    method: str
    params: dict[str, Any]


class _RawResult(RootModel[Any]):
    """Result model used by the backwards-compatible raw request API."""


class WebSocketConnector(BaseConnector):
    """Connector for MCP implementations using WebSocket transport.

    This connector uses WebSockets to communicate with remote MCP implementations,
    using a connection manager to handle the proper lifecycle management.
    """

    def __init__(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        auth: str | dict[str, Any] | httpx.Auth | None = None,
        sampling_callback: SamplingFnT | None = None,
        elicitation_callback: ElicitationFnT | None = None,
        message_handler: MessageHandlerFnT | None = None,
        logging_callback: LoggingFnT | None = None,
        middleware: list[Middleware] | None = None,
        roots: list[Root] | None = None,
        list_roots_callback: ListRootsFnT | None = None,
    ):
        """Initialize a new WebSocket connector.

        Args:
            url: The WebSocket URL to connect to.
            headers: Optional additional headers.
            auth: Authentication method - can be:
                - A string token: Use Bearer token authentication
                - A dict: Not supported for WebSocket (will log warning)
                - An httpx.Auth object: Not supported for WebSocket (will log warning)
            sampling_callback: Optional sampling callback.
            elicitation_callback: Optional elicitation callback.
            message_handler: Optional callback to handle messages.
            logging_callback: Optional callback to handle log messages.
            middleware: Optional list of middleware.
            roots: Optional initial list of roots to advertise to the server.
            list_roots_callback: Optional custom callback to handle roots/list requests.
        """
        super().__init__(
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
            middleware=middleware,
            roots=roots,
            list_roots_callback=list_roots_callback,
        )
        self.url = url
        self.headers = headers or {}

        # Handle authentication - WebSocket only supports bearer tokens
        # An auth field it's not needed
        if auth is not None:
            if isinstance(auth, str):
                self.headers["Authorization"] = f"Bearer {auth}"
            else:
                logger.warning("WebSocket connector only supports bearer token authentication")

    async def connect(self) -> None:
        """Establish a connection to the MCP implementation."""
        if self._connected:
            logger.debug("Already connected to MCP implementation")
            return

        logger.debug(f"Connecting to MCP implementation via WebSocket: {self.url}")
        try:
            # Create and start the connection manager
            self._connection_manager = WebSocketConnectionManager(self.url, self.headers)
            read_stream, write_stream = await self._connection_manager.start()

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

            self.client_session = CallbackClientSession(
                raw_client_session, self.public_identifier, self.middleware_manager
            )

            # Mark as connected
            self._connected = True
            logger.debug(f"Successfully connected to MCP implementation via WebSocket: {self.url}")

        except Exception as e:
            logger.error(f"Failed to connect to MCP implementation via WebSocket: {e}")

            # Clean up any resources if connection failed
            await self._cleanup_resources()

            # Re-raise the original exception
            raise

    async def request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Send a raw request through the MCP session and middleware chain."""
        await self._ensure_connected()
        if not self.client_session:  # pragma: no cover - guaranteed by _ensure_connected
            raise RuntimeError("MCP client is not connected")

        context = MiddlewareContext(
            id=str(uuid.uuid4()),
            method=method,
            params=params or {},
            connection_id=self.public_identifier,
            timestamp=time.time(),
        )

        async def send_request(request_context: MiddlewareContext[dict[str, Any]]) -> Any:
            result = await self.client_session.send_request(
                _RawRequest(method=request_context.method, params=request_context.params),
                _RawResult,
            )
            return result.root

        response = await self.middleware_manager.process_request(context, send_request)
        if response.error:
            raise response.error
        return response.result

    @property
    def public_identifier(self) -> str:
        """Get the identifier for the connector."""
        return f"websocket:{self.url}"
