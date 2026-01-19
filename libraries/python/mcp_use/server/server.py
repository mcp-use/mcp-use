from __future__ import annotations

import inspect
import logging
import os
import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, cast

import mcp.server.lowlevel.server as lowlevel
import mcp.server.session as mcp_session
from mcp.server.fastmcp import FastMCP
from mcp.types import (
    AnyFunction,
    CallToolRequest,
    GetPromptRequest,
    ListPromptsRequest,
    ListResourcesRequest,
    ListToolsRequest,
    ReadResourceRequest,
    ServerResult,
)

# Import auth components
from mcp_use.server.auth import AuthMiddleware, BearerAuthProvider
from mcp_use.server.context import Context as MCPContext
from mcp_use.server.logging import MCPLoggingMiddleware
from mcp_use.server.middleware import (
    Middleware,
    MiddlewareManager,
    ServerMiddlewareContext,
    TelemetryMiddleware,
)
from mcp_use.server.middleware.server_session import MiddlewareServerSession
from mcp_use.server.runner import ServerRunner
from mcp_use.server.types import TransportType
from mcp_use.server.utils.inspector import _inspector_index, _inspector_static
from mcp_use.server.utils.routes import docs_ui, openmcp_json
from mcp_use.telemetry.telemetry import Telemetry, telemetry
from mcp_use.telemetry.utils import track_server_run_from_server

# Monkey patching for init request of middleware
mcp_session.ServerSession = MiddlewareServerSession
lowlevel.ServerSession = MiddlewareServerSession

if TYPE_CHECKING:
    from mcp.server.session import ServerSession

    from mcp_use.server.router import MCPRouter


logger = logging.getLogger(__name__)
_telemetry = Telemetry()


class MCPServer(FastMCP):
    """Main MCP Server class with integrated inspector and development tools."""

    def __init__(
        self,
        name: str | None = None,
        version: str | None = None,
        instructions: str | None = None,
        auth: BearerAuthProvider | None = None,
        middleware: list[Middleware] | None = None,
        debug: bool = False,
        mcp_path: str = "/mcp",
        docs_path: str = "/docs",
        inspector_path: str = "/inspector",
        openmcp_path: str = "/openmcp.json",
        show_inspector_logs: bool = False,
        pretty_print_jsonrpc: bool = False,
    ):
        self._start_time = time.time()
        super().__init__(name=name or "mcp-use server", instructions=instructions)

        if version:
            self._mcp_server.version = version

        # Store auth provider
        self._auth = auth

        # Set debug level: DEBUG env var takes precedence, then debug parameter
        env_debug_level = self._parse_debug_level()
        if env_debug_level > 0:
            # Environment variable overrides parameter
            self.debug_level = env_debug_level
        else:
            # Use debug parameter (0 or 1)
            self.debug_level = 1 if debug else 0

        # Set route paths
        self.mcp_path = mcp_path
        self.docs_path = docs_path
        self.inspector_path = inspector_path
        self.openmcp_path = openmcp_path
        self.show_inspector_logs = show_inspector_logs
        self.pretty_print_jsonrpc = pretty_print_jsonrpc
        self._transport_type: TransportType = "streamable-http"

        self.middleware_manager = MiddlewareManager()
        self.middleware_manager.add_middleware(TelemetryMiddleware())

        if middleware:
            for middleware_instance in middleware:
                self.middleware_manager.add_middleware(middleware_instance)

        # Add dev routes only in DEBUG=1 and above
        if self.debug_level >= 1:
            self._add_dev_routes()

        self.app = self.streamable_http_app()

        # Inject middleware in the ServerSession
        MiddlewareServerSession._middleware_manager = self.middleware_manager
        MiddlewareServerSession._transport_type = self._transport_type

    @property
    def debug(self) -> bool:
        """Whether debug mode is enabled."""
        return self.debug_level >= 1

    def _parse_debug_level(self) -> int:
        """Parse DEBUG environment variable to get debug level.

        Returns:
            0: Production mode (clean logs only)
            1: Debug mode (clean logs + dev routes)
            2: Full debug mode (clean logs + dev routes + JSON-RPC logging)
        """
        debug_env = os.environ.get("DEBUG", "0")
        try:
            level = int(debug_env)
            return max(0, min(2, level))  # Clamp between 0-2
        except ValueError:
            # Handle string values
            if debug_env.lower() in ("1", "true", "yes"):
                return 1
            elif debug_env.lower() in ("2", "full", "verbose"):
                return 2
            else:
                return 0

    def _add_dev_routes(self):
        """Add development routes for debugging and inspection."""

        # OpenMCP configuration
        async def openmcp_handler(request):
            return await openmcp_json(request, self)

        self.custom_route(self.openmcp_path, methods=["GET"])(openmcp_handler)

        # Documentation UI
        self.custom_route(self.docs_path, methods=["GET"])(docs_ui)

        # Inspector routes - wrap to pass mcp_path
        async def inspector_index_handler(request):
            return await _inspector_index(request, mcp_path=self.mcp_path)

        self.custom_route(self.inspector_path, methods=["GET"])(inspector_index_handler)
        self.custom_route(f"{self.inspector_path}/{{path:path}}", methods=["GET"])(_inspector_static)

    @telemetry("server_router_used")
    def include_router(self, router: MCPRouter, prefix: str = "", enabled: bool = True) -> None:
        """
        Include a router's tools, resources, and prompts into this server.

        Similar to FastAPI's include_router, this allows you to organize your
        MCP server into multiple files/modules.

        Args:
            router: The MCPRouter instance to include
            prefix: Optional prefix to add to all tool names (e.g., "math" -> "math_add")
            enabled: Whether to enable this router (default True). Set to False to skip registration.

        Example:
            ```python
            from mcp_use.server import MCPServer, MCPRouter

            # In routes/math.py
            router = MCPRouter()

            @router.tool()
            def add(a: int, b: int) -> int:
                return a + b

            # In main.py
            server = MCPServer(name="my-server")
            server.include_router(router, prefix="math")  # Tool becomes "math_add"
            server.include_router(other_router, enabled=False)  # Skip this router
            ```
        """
        if not enabled:
            return
        # Register all tools from the router
        for tool in router.tools:
            tool_name = tool.name or getattr(tool.fn, "__name__", "unknown")
            if prefix:
                tool_name = f"{prefix}_{tool_name}"

            self.add_tool(
                tool.fn,
                name=tool_name,
                title=tool.title,
                description=tool.description,
                annotations=tool.annotations,
                structured_output=tool.structured_output,
            )

        # Register all resources from the router
        for resource in router.resources:
            resource_name = resource.name or getattr(resource.fn, "__name__", "unknown")
            if prefix:
                resource_name = f"{prefix}_{resource_name}"
            self.resource(
                uri=resource.uri,
                name=resource.name,
                description=resource.description,
                mime_type=resource.mime_type,
            )(resource.fn)

        # Register all prompts from the router
        for prompt in router.prompts:
            prompt_name = prompt.name or getattr(prompt.fn, "__name__", "unknown")
            if prefix:
                prompt_name = f"{prefix}_{prompt_name}"

            self.prompt(
                name=prompt_name,
                description=prompt.description,
            )(prompt.fn)

    def streamable_http_app(self):
        """Override to add our custom middleware."""
        from starlette.middleware.cors import CORSMiddleware

        app = super().streamable_http_app()

        # Add MCP logging middleware (cast to satisfy type checker)
        app.add_middleware(
            cast(type, MCPLoggingMiddleware),
            debug_level=self.debug_level,
            mcp_path=self.mcp_path,
            pretty_print_jsonrpc=self.pretty_print_jsonrpc,
        )

        # Add auth middleware if provider is configured
        if self._auth:
            app.add_middleware(
                cast(type, AuthMiddleware),
                auth_provider=self._auth,
            )
            logger.debug("AuthMiddleware added to application")

            # Add CORS middleware when auth is enabled (handles OPTIONS preflight)
            # Note: allow_credentials=False because allow_origins=["*"] - browsers reject the combination
            app.add_middleware(
                CORSMiddleware,
                allow_origins=["*"],
                allow_credentials=False,
                allow_methods=["GET", "POST", "OPTIONS"],
                allow_headers=["*"],
                expose_headers=["WWW-Authenticate"],
            )

        return app

    def _wrap_handlers_with_middleware(self) -> None:
        handlers = self._mcp_server.request_handlers

        if self.debug_level >= 1:
            logger.debug(f"Wrapping handlers. Available handlers: {list(handlers.keys())}")

        def wrap_request(request_cls: type, method: str) -> None:
            if request_cls not in handlers:
                return

            original = handlers[request_cls]

            async def wrapped(request: Any) -> ServerResult:
                # Get session ID from HTTP headers if available
                session_id = self._get_session_id_from_request()

                context = ServerMiddlewareContext(
                    message=request.params,
                    method=method,
                    timestamp=datetime.now(UTC),
                    transport=self._transport_type,
                    session_id=session_id,
                )

                async def call_original(_: ServerMiddlewareContext[Any]) -> Any:
                    return await original(request)

                return await self.middleware_manager.process_request(context, call_original)

            handlers[request_cls] = wrapped

        wrap_request(CallToolRequest, "tools/call")
        wrap_request(ReadResourceRequest, "resources/read")
        wrap_request(GetPromptRequest, "prompts/get")
        wrap_request(ListToolsRequest, "tools/list")
        wrap_request(ListResourcesRequest, "resources/list")
        wrap_request(ListPromptsRequest, "prompts/list")

    def run(  # type: ignore[override]
        self,
        transport: TransportType = "streamable-http",
        host: str = "127.0.0.1",
        port: int = 8000,
        reload: bool = False,
        debug: bool = False,
    ) -> None:
        """Run the MCP server.

        Args:
            transport: Transport protocol to use ("stdio", "streamable-http" or "sse")
            host: Host to bind to
            port: Port to bind to
            reload: Whether to enable auto-reload
            debug: Whether to enable debug mode. Overrides the server's debug setting,
                   adds /docs and /openmcp.json endpoints if not already added.
        """
        # Override debug_level if debug=True is passed to run()
        if debug and self.debug_level < 1:
            self.debug_level = 1

        self._transport_type = transport
        track_server_run_from_server(self, transport, host, port, _telemetry)

        self._wrap_handlers_with_middleware()

        runner = ServerRunner(self)
        runner.run(transport=transport, host=host, port=port, reload=reload, debug=debug)

    def get_context(self) -> MCPContext:  # type: ignore[override]
        """Use the extended MCP-Use context that adds convenience helpers."""
        return MCPContext(request_context=self._get_request_context(), fastmcp=self)  # type: ignore[override]

    def _resource_is_template(self, fn: AnyFunction, uri: str) -> bool:
        has_uri_params = "{" in uri and "}" in uri
        if has_uri_params:
            return True
        return bool(inspect.signature(fn).parameters)

    def _current_session(self) -> ServerSession | None:
        request_context = self._get_request_context()
        if request_context is None:
            return None
        return request_context.session

    def _get_request_context(self):
        try:
            return self._mcp_server.request_context
        except LookupError:
            return None

    def _get_session_id(self) -> str | None:
        """Get session ID from the session object (deprecated - use _get_session_id_from_request)."""
        session = self._current_session()
        if session is None:
            return None

        try:
            return session.session_id  # type: ignore[attr-defined]
        except AttributeError:
            try:
                return session.id  # type: ignore[attr-defined]
            except AttributeError:
                return None

    def _get_session_id_from_request(self) -> str | None:
        """Get session ID from HTTP request headers (for Streamable HTTP transport).

        The session ID is managed at the transport layer and sent via the
        mcp-session-id header according to the MCP specification.
        """
        request_context = self._get_request_context()
        if request_context is None:
            return None

        # Try to get the HTTP request from context
        request = getattr(request_context, "request", None)
        if request is None:
            return None

        # Extract mcp-session-id header
        try:
            return request.headers.get("mcp-session-id")
        except (AttributeError, KeyError):
            return None
