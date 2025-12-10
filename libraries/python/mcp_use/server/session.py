"""Custom ServerSession that integrates with mcp-use middleware."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from mcp.server.session import ServerSession
from mcp.types import InitializeRequest

if TYPE_CHECKING:
    from mcp.shared.session import RequestResponder
    from mcp.types import ClientRequest, ServerResult

    from mcp_use.server.middleware import MiddlewareManager, ServerMiddlewareContext


class MCPUseServerSession(ServerSession):
    """ServerSession that routes initialize requests through mcp-use's middleware system.

    This custom session class intercepts InitializeRequest messages and routes them
    through the middleware chain, allowing middleware to observe and interact with
    the initialization process.

    All other requests are handled by the parent ServerSession as normal.
    """

    def __init__(
        self,
        middleware_manager: MiddlewareManager,
        transport_type: str,
        *args: Any,
        **kwargs: Any,
    ):
        """Initialize the custom session.

        Args:
            middleware_manager: The middleware manager to process requests through
            transport_type: The transport type (e.g., 'streamable-http', 'stdio')
            *args: Positional arguments for ServerSession
            **kwargs: Keyword arguments for ServerSession
        """
        super().__init__(*args, **kwargs)
        self.middleware_manager = middleware_manager
        self.transport_type = transport_type

    async def _received_request(
        self,
        responder: RequestResponder[ClientRequest, ServerResult],
    ) -> None:
        """Override to route InitializeRequest through middleware.

        For InitializeRequest, creates a ServerMiddlewareContext and processes
        the request through the middleware chain before forwarding to the parent
        implementation.

        For all other requests, delegates directly to the parent implementation.

        Args:
            responder: The request responder containing the client request
        """
        # Only handle InitializeRequest specially - all others use default handling
        if not isinstance(responder.request.root, InitializeRequest):
            return await super()._received_request(responder)

        # Import here to avoid circular imports
        from mcp_use.server.middleware import ServerMiddlewareContext

        # Get session ID if available
        session_id = getattr(self, "session_id", None)

        # Create middleware context using mcp-use's context structure
        context: ServerMiddlewareContext = ServerMiddlewareContext(
            message=responder.request.root.params,
            method="initialize",
            timestamp=datetime.now(UTC),
            transport=self.transport_type,
            session_id=session_id,
        )

        # Define the original handler that calls parent's implementation
        async def call_original(_: ServerMiddlewareContext[Any]) -> Any:
            return await super(MCPUseServerSession, self)._received_request(responder)

        # Process through middleware chain
        return await self.middleware_manager.process_request(context, call_original)
