"""
Unit tests for the on_initialize middleware hook.

These tests verify that:
1. The initialize method is correctly routed to the on_initialize hook
2. Middleware chain executes in correct order for initialize requests
3. Middleware can reject connections by raising exceptions
4. Context enrichment works through the middleware chain
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from mcp.types import ClientCapabilities, Implementation, InitializeRequestParams

from mcp_use.server.middleware import Middleware, MiddlewareManager, ServerMiddlewareContext


class TestOnInitializeDispatch:
    """Test that initialize requests are routed to on_initialize hook."""

    @pytest.mark.asyncio
    async def test_initialize_method_calls_on_initialize_hook(self):
        """Verify on_initialize is invoked when method is 'initialize'."""
        hook_called = False
        received_context = None

        class TrackingMiddleware(Middleware):
            async def on_initialize(self, context, call_next):
                nonlocal hook_called, received_context
                hook_called = True
                received_context = context
                return await call_next(context)

        manager = MiddlewareManager()
        manager.add_middleware(TrackingMiddleware())

        params = InitializeRequestParams(
            protocolVersion="2024-11-05",
            capabilities=ClientCapabilities(),
            clientInfo=Implementation(name="test-client", version="1.0.0"),
        )
        context = ServerMiddlewareContext(
            message=params,
            method="initialize",
            timestamp=datetime.now(),
            transport="streamable-http",
        )

        handler = AsyncMock(return_value="init_result")
        result = await manager.process_request(context, handler)

        assert hook_called, "on_initialize should be called for initialize method"
        assert received_context is not None
        assert received_context.method == "initialize"
        assert received_context.message.clientInfo.name == "test-client"
        assert result == "init_result"

    @pytest.mark.asyncio
    async def test_non_initialize_method_skips_on_initialize(self):
        """Verify on_initialize is NOT called for non-initialize methods."""
        on_initialize_called = False
        on_call_tool_called = False

        class TrackingMiddleware(Middleware):
            async def on_initialize(self, context, call_next):
                nonlocal on_initialize_called
                on_initialize_called = True
                return await call_next(context)

            async def on_call_tool(self, context, call_next):
                nonlocal on_call_tool_called
                on_call_tool_called = True
                return await call_next(context)

        manager = MiddlewareManager()
        manager.add_middleware(TrackingMiddleware())

        context = ServerMiddlewareContext(
            message=MagicMock(),
            method="tools/call",
            timestamp=datetime.now(),
            transport="streamable-http",
        )

        await manager.process_request(context, AsyncMock(return_value="tool_result"))

        assert not on_initialize_called, "on_initialize should not be called for tools/call"
        assert on_call_tool_called, "on_call_tool should be called for tools/call"

    @pytest.mark.asyncio
    async def test_on_request_still_called_for_initialize(self):
        """Verify on_request is called in addition to on_initialize."""
        on_request_called = False
        on_initialize_called = False

        class TrackingMiddleware(Middleware):
            async def on_request(self, context, call_next):
                nonlocal on_request_called
                on_request_called = True
                return await call_next(context)

            async def on_initialize(self, context, call_next):
                nonlocal on_initialize_called
                on_initialize_called = True
                return await call_next(context)

        manager = MiddlewareManager()
        manager.add_middleware(TrackingMiddleware())

        context = ServerMiddlewareContext(
            message=MagicMock(),
            method="initialize",
            timestamp=datetime.now(),
            transport="stdio",
        )

        await manager.process_request(context, AsyncMock(return_value="ok"))

        assert on_request_called, "on_request should always be called"
        assert on_initialize_called, "on_initialize should be called for initialize"


class TestMiddlewareChainForInitialize:
    """Test middleware chain behavior for initialize requests."""

    @pytest.mark.asyncio
    async def test_middleware_chain_executes_in_order(self):
        """Verify middleware executes in correct onion order (first added = outermost)."""
        execution_order = []

        class OrderedMiddleware(Middleware):
            def __init__(self, name: str):
                self.name = name

            async def on_initialize(self, context, call_next):
                execution_order.append(f"{self.name}_before")
                result = await call_next(context)
                execution_order.append(f"{self.name}_after")
                return result

        manager = MiddlewareManager()
        manager.add_middleware(OrderedMiddleware("first"))
        manager.add_middleware(OrderedMiddleware("second"))
        manager.add_middleware(OrderedMiddleware("third"))

        context = ServerMiddlewareContext(
            message=MagicMock(),
            method="initialize",
            timestamp=datetime.now(),
            transport="stdio",
        )

        await manager.process_request(context, AsyncMock(return_value="done"))

        # Onion model: first middleware wraps second, which wraps third
        assert execution_order == [
            "first_before",
            "second_before",
            "third_before",
            "third_after",
            "second_after",
            "first_after",
        ], f"Expected onion order, got: {execution_order}"

    @pytest.mark.asyncio
    async def test_middleware_can_short_circuit(self):
        """Verify middleware can stop the chain by not calling call_next."""
        final_handler_called = False

        class ShortCircuitMiddleware(Middleware):
            async def on_initialize(self, context, call_next):
                # Return early without calling call_next
                return {"short": "circuited"}

        manager = MiddlewareManager()
        manager.add_middleware(ShortCircuitMiddleware())

        context = ServerMiddlewareContext(
            message=MagicMock(),
            method="initialize",
            timestamp=datetime.now(),
            transport="streamable-http",
        )

        async def final_handler(_):
            nonlocal final_handler_called
            final_handler_called = True
            return "should not reach"

        result = await manager.process_request(context, final_handler)

        assert result == {"short": "circuited"}
        assert not final_handler_called, "Final handler should not be called when middleware short-circuits"


class TestMiddlewareConnectionRejection:
    """Test middleware ability to reject connections during initialize."""

    @pytest.mark.asyncio
    async def test_middleware_can_reject_by_raising_exception(self):
        """Verify middleware can reject clients by raising exceptions."""

        class RejectingMiddleware(Middleware):
            async def on_initialize(self, context, call_next):
                client_name = context.message.clientInfo.name
                if client_name == "blocked-client":
                    raise ValueError(f"Client '{client_name}' is not allowed to connect")
                return await call_next(context)

        manager = MiddlewareManager()
        manager.add_middleware(RejectingMiddleware())

        params = InitializeRequestParams(
            protocolVersion="2024-11-05",
            capabilities=ClientCapabilities(),
            clientInfo=Implementation(name="blocked-client", version="1.0.0"),
        )
        context = ServerMiddlewareContext(
            message=params,
            method="initialize",
            timestamp=datetime.now(),
            transport="streamable-http",
        )

        with pytest.raises(ValueError, match="blocked-client.*not allowed"):
            await manager.process_request(context, AsyncMock())

    @pytest.mark.asyncio
    async def test_allowed_client_passes_through(self):
        """Verify allowed clients pass through the rejection middleware."""

        class RejectingMiddleware(Middleware):
            async def on_initialize(self, context, call_next):
                client_name = context.message.clientInfo.name
                if client_name == "blocked-client":
                    raise ValueError(f"Client '{client_name}' is not allowed")
                return await call_next(context)

        manager = MiddlewareManager()
        manager.add_middleware(RejectingMiddleware())

        params = InitializeRequestParams(
            protocolVersion="2024-11-05",
            capabilities=ClientCapabilities(),
            clientInfo=Implementation(name="allowed-client", version="1.0.0"),
        )
        context = ServerMiddlewareContext(
            message=params,
            method="initialize",
            timestamp=datetime.now(),
            transport="streamable-http",
        )

        handler = AsyncMock(return_value={"serverInfo": {"name": "test-server"}})
        result = await manager.process_request(context, handler)

        assert result == {"serverInfo": {"name": "test-server"}}
        handler.assert_called_once()


class TestContextEnrichment:
    """Test middleware ability to enrich context for downstream handlers."""

    @pytest.mark.asyncio
    async def test_middleware_can_add_metadata(self):
        """Verify middleware can enrich context.metadata for downstream middleware."""
        captured_metadata = None

        class EnrichingMiddleware(Middleware):
            async def on_initialize(self, context, call_next):
                enriched = context.copy(
                    metadata={**context.metadata, "enriched_by": "first_middleware", "validated": True}
                )
                return await call_next(enriched)

        class CapturingMiddleware(Middleware):
            async def on_initialize(self, context, call_next):
                nonlocal captured_metadata
                captured_metadata = context.metadata.copy()
                return await call_next(context)

        manager = MiddlewareManager()
        manager.add_middleware(EnrichingMiddleware())
        manager.add_middleware(CapturingMiddleware())

        context = ServerMiddlewareContext(
            message=MagicMock(),
            method="initialize",
            timestamp=datetime.now(),
            transport="streamable-http",
            metadata={"original": "value"},
        )

        await manager.process_request(context, AsyncMock(return_value="ok"))

        assert captured_metadata is not None
        assert captured_metadata.get("original") == "value"
        assert captured_metadata.get("enriched_by") == "first_middleware"
        assert captured_metadata.get("validated") is True

    @pytest.mark.asyncio
    async def test_context_immutability(self):
        """Verify original context is not mutated when using copy()."""
        original_context = ServerMiddlewareContext(
            message=MagicMock(),
            method="initialize",
            timestamp=datetime.now(),
            transport="stdio",
            metadata={"original": True},
        )

        class ModifyingMiddleware(Middleware):
            async def on_initialize(self, context, call_next):
                modified = context.copy(metadata={"modified": True})
                return await call_next(modified)

        manager = MiddlewareManager()
        manager.add_middleware(ModifyingMiddleware())

        await manager.process_request(original_context, AsyncMock(return_value="ok"))

        # Original should be unchanged (frozen dataclass)
        assert original_context.metadata == {"original": True}


class TestDefaultMiddlewareBehavior:
    """Test default pass-through behavior of base Middleware class."""

    @pytest.mark.asyncio
    async def test_default_on_initialize_passes_through(self):
        """Base Middleware.on_initialize should simply call next."""
        middleware = Middleware()
        expected_result = {"serverInfo": {"name": "test", "version": "1.0"}}

        context = ServerMiddlewareContext(
            message=MagicMock(),
            method="initialize",
            timestamp=datetime.now(),
            transport="stdio",
        )

        next_handler = AsyncMock(return_value=expected_result)
        result = await middleware.on_initialize(context, next_handler)

        assert result == expected_result
        next_handler.assert_called_once_with(context)

    @pytest.mark.asyncio
    async def test_empty_middleware_manager_calls_handler_directly(self):
        """MiddlewareManager with no middleware should just call the handler."""
        manager = MiddlewareManager()

        context = ServerMiddlewareContext(
            message=MagicMock(),
            method="initialize",
            timestamp=datetime.now(),
            transport="streamable-http",
        )

        handler = AsyncMock(return_value="direct_result")
        result = await manager.process_request(context, handler)

        assert result == "direct_result"
        handler.assert_called_once_with(context)


class TestInitializeWithClientInfo:
    """Test initialize middleware with realistic client info scenarios."""

    @pytest.mark.asyncio
    async def test_can_inspect_protocol_version(self):
        """Verify middleware can inspect and act on protocol version."""
        rejected_versions = []

        class VersionCheckMiddleware(Middleware):
            async def on_initialize(self, context, call_next):
                version = context.message.protocolVersion
                if version < "2024-01-01":
                    rejected_versions.append(version)
                    raise ValueError(f"Protocol version {version} is too old")
                return await call_next(context)

        manager = MiddlewareManager()
        manager.add_middleware(VersionCheckMiddleware())

        old_params = InitializeRequestParams(
            protocolVersion="2023-06-01",
            capabilities=ClientCapabilities(),
            clientInfo=Implementation(name="old-client", version="0.1.0"),
        )
        context = ServerMiddlewareContext(
            message=old_params,
            method="initialize",
            timestamp=datetime.now(),
            transport="stdio",
        )

        with pytest.raises(ValueError, match="too old"):
            await manager.process_request(context, AsyncMock())

        assert "2023-06-01" in rejected_versions

    @pytest.mark.asyncio
    async def test_can_log_client_capabilities(self):
        """Verify middleware can access and log client capabilities."""
        logged_capabilities = []

        class LoggingMiddleware(Middleware):
            async def on_initialize(self, context, call_next):
                caps = context.message.capabilities
                logged_capabilities.append(
                    {
                        "client": context.message.clientInfo.name,
                        "has_sampling": caps.sampling is not None if caps else False,
                    }
                )
                return await call_next(context)

        manager = MiddlewareManager()
        manager.add_middleware(LoggingMiddleware())

        params = InitializeRequestParams(
            protocolVersion="2024-11-05",
            capabilities=ClientCapabilities(sampling={}),
            clientInfo=Implementation(name="capable-client", version="2.0.0"),
        )
        context = ServerMiddlewareContext(
            message=params,
            method="initialize",
            timestamp=datetime.now(),
            transport="streamable-http",
        )

        await manager.process_request(context, AsyncMock(return_value="ok"))

        assert len(logged_capabilities) == 1
        assert logged_capabilities[0]["client"] == "capable-client"
        assert logged_capabilities[0]["has_sampling"] is True
