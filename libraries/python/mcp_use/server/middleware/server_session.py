from __future__ import annotations

import weakref
from datetime import datetime

import mcp.types as types
from mcp.server.session import ServerSession
from mcp.shared.session import RequestResponder

from mcp_use.server.middleware import MiddlewareManager, ServerMiddlewareContext


class MiddlewareServerSession(ServerSession):
    """Extended ServerSession that routes initialize requests through middleware.

    This class intercepts the MCP initialize handshake at the protocol layer,
    allowing middleware to:
    - Validate client capabilities or metadata during connection
    - Log connection attempts and protocol versions
    - Reject connections early based on initialization parameters

    It also tracks all active sessions so the server can broadcast notifications
    (e.g., ``notifications/resources/updated``) to all connected clients.

    The class is injected via monkey-patching of ``mcp.server.session.ServerSession``
    to intercept session creation within the MCP SDK.

    Note:
        This implementation uses class attributes for middleware injection,
        which means only ONE MCPServer instance is supported per process.
        This is compatible with standard deployment patterns (e.g., uvicorn workers
        run in separate processes), but multiple MCPServer instances in the
        same process will share/override each other's middleware configuration.

    Attributes:
        _middleware_manager: The middleware manager to process initialize requests.
            Injected by MCPServer during initialization.
        _transport_type: The transport type (e.g., "stdio", "streamable-http").
            Injected by MCPServer during initialization.
        _active_sessions: Weak set of all active sessions for broadcasting notifications.
    """

    _middleware_manager: MiddlewareManager | None = None
    _transport_type: str = "unknown"
    _active_sessions: weakref.WeakSet[MiddlewareServerSession] = weakref.WeakSet()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        MiddlewareServerSession._active_sessions.add(self)

    async def _received_request(self, responder: RequestResponder[types.ClientRequest, types.ServerResult]) -> None:
        if responder.request.root.method and responder.request.root.method == "initialize":
            if not self._middleware_manager:
                # Fallback to normal behavior if middleware isn't injected yet
                return await ServerSession._received_request(self, responder)

            ctx = ServerMiddlewareContext(
                message=responder.request.root.params,
                method="initialize",
                timestamp=datetime.now(),
                transport=self._transport_type,
                session_id=getattr(self, "session_id", None),
            )

            async def call_original(_):
                return await ServerSession._received_request(self, responder)

            return await self._middleware_manager.process_request(ctx, call_original)

        return await ServerSession._received_request(self, responder)
