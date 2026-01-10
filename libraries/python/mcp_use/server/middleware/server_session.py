from datetime import datetime

import mcp.types as types
from mcp.server.session import ServerSession
from mcp.shared.session import RequestResponder

from mcp_use.server.middleware import MiddlewareManager, ServerMiddlewareContext


class MiddlewareServerSession(ServerSession):
    _middleware_manager: MiddlewareManager | None = None
    _transport_type: str = "unknown"

    async def _received_request(self, responder: RequestResponder[types.ClientRequest, types.ServerResult]):
        if responder.request.root.method and responder.request.root.method == "initialize":
            if not self._middleware_manager:
                # Fallback to normal behavior if middleware isn't injected yet
                return await super()._received_request(responder)

            ctx = ServerMiddlewareContext(
                message=responder.request.root.params,
                method="initialize",
                timestamp=datetime.now(),
                transport=self._transport_type,
                session_id=getattr(self, "session_id", None),
            )

            async def call_original(_):
                return await super()._received_request(responder)

            return await self._middleware_manager.process_request(ctx, call_original)

        return await super()._received_request(responder)