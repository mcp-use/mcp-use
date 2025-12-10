"""Custom low-level server that uses mcp-use's middleware-enabled session."""

from __future__ import annotations

from contextlib import AsyncExitStack
from typing import TYPE_CHECKING, Any

import anyio
from anyio.streams.memory import MemoryObjectReceiveStream, MemoryObjectSendStream
from mcp.server.lowlevel.server import LifespanResultT, RequestT
from mcp.server.lowlevel.server import Server as MCPServer
from mcp.server.models import InitializationOptions
from mcp.shared.message import SessionMessage

from mcp_use.server.session import MCPUseServerSession

if TYPE_CHECKING:
    from mcp_use.server.middleware import MiddlewareManager


class MCPUseLowLevelServer(MCPServer[LifespanResultT, RequestT]):
    """Low-level MCP server that uses MCPUseServerSession for middleware integration.

    This minimal wrapper around the official MCP Server replaces the standard
    ServerSession with MCPUseServerSession, which routes initialize requests
    through the middleware chain.

    The rest of the server behavior remains unchanged from the official implementation.
    """

    def __init__(
        self,
        middleware_manager: MiddlewareManager,
        transport_type: str,
        *args: Any,
        **kwargs: Any,
    ):
        """Initialize the low-level server.

        Args:
            middleware_manager: The middleware manager for processing requests
            transport_type: The transport type (e.g., 'streamable-http', 'stdio')
            *args: Positional arguments for the base Server
            **kwargs: Keyword arguments for the base Server
        """
        super().__init__(*args, **kwargs)
        self.middleware_manager = middleware_manager
        self.transport_type = transport_type

    async def run(
        self,
        read_stream: MemoryObjectReceiveStream[SessionMessage | Exception],
        write_stream: MemoryObjectSendStream[SessionMessage],
        initialization_options: InitializationOptions,
        raise_exceptions: bool = False,
        stateless: bool = False,
    ) -> None:
        """Run the server with a custom middleware-enabled session.

        This overrides the base Server.run() to use MCPUseServerSession instead of
        the standard ServerSession, enabling middleware for initialize requests.

        Args:
            read_stream: Stream for reading incoming messages
            write_stream: Stream for writing outgoing messages
            initialization_options: Server initialization configuration
            raise_exceptions: Whether to raise exceptions or return them as messages
            stateless: Whether the server is stateless (allows any node to initialize)
        """
        async with AsyncExitStack() as stack:
            # Enter the lifespan context
            lifespan_context = await stack.enter_async_context(self.lifespan(self))

            # Create our custom session that routes through middleware
            session = await stack.enter_async_context(
                MCPUseServerSession(
                    middleware_manager=self.middleware_manager,
                    transport_type=self.transport_type,
                    read_stream=read_stream,
                    write_stream=write_stream,
                    init_options=initialization_options,
                    stateless=stateless,
                )
            )

            # Process messages using the standard message handling loop
            async with anyio.create_task_group() as tg:
                async for message in session.incoming_messages:
                    tg.start_soon(
                        self._handle_message,
                        message,
                        session,
                        lifespan_context,
                        raise_exceptions,
                    )
