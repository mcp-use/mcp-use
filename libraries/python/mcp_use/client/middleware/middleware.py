"""
Core middleware system for MCP requests.

This module provides a robust and extensible middleware architecture:
- A typed MiddlewareContext to carry request data.
- A Middleware base class with a dispatcher that routes to strongly-typed hooks.
- A MiddlewareManager to build and execute the processing chain.
- A CallbackClientSession that acts as an adapter, creating the initial context
  without requiring changes to upstream callers like HttpConnector.
"""

import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import partial
from typing import Any, Generic, Protocol, TypeVar

from mcp import ClientSession
from mcp.types import (
    CallToolRequestParams,
    CallToolResult,
    GetPromptRequestParams,
    GetPromptResult,
    InitializeRequestParams,
    InitializeResult,
    JSONRPCResponse,
    ListPromptsRequest,
    ListPromptsResult,
    ListResourcesRequest,
    ListResourcesResult,
    ListToolsRequest,
    ListToolsResult,
    ReadResourceRequestParams,
    ReadResourceResult,
)

from mcp_use.telemetry.telemetry import telemetry

# Generig TypeVars for context and results
T = TypeVar("T")
R = TypeVar("R", covariant=True)


@dataclass
class MiddlewareContext(Generic[T]):
    """Unified, typed context for all middleware operations."""

    id: str
    method: str  # The JSON-RPC method name, e.g., "tools/call"
    params: T  # The typed parameters for the method
    connection_id: str
    timestamp: float
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class MCPResponseContext:
    """Extended context for MCP responses with middleware metadata."""

    request_id: str
    result: Any
    error: Exception | None
    duration: float
    metadata: dict[str, Any]
    jsonrpc_response: JSONRPCResponse | None = None

    @classmethod
    def create(cls, request_id: str, result: Any = None, error: Exception = None) -> "MCPResponseContext":
        return cls(request_id=request_id, result=result, error=error, duration=0.0, metadata={})


# Protocol definition for middleware
class NextFunctionT(Protocol[T, R]):
    """Protocol for the `call_next` function passed to middleware."""

    async def __call__(self, context: MiddlewareContext[T]) -> R: ...


class Middleware:
    """Base class for middlewares with hooks."""

    async def __call__(self, context: MiddlewareContext[T], call_next: NextFunctionT[T, Any]) -> Any:
        """Main entry point that orchestrates the chain"""
        handler_chain = await self._dispatch_handler(context, call_next)
        return await handler_chain(context)

    async def _dispatch_handler(
        self, context: MiddlewareContext[Any], call_next: NextFunctionT[Any, Any]
    ) -> NextFunctionT[Any, Any]:
        """Build a chain of handlers"""
        handler = call_next

        method_map = {
            "initialize": self.on_initialize,
            "tools/call": self.on_call_tool,
            "tools/list": self.on_list_tools,
            "resources/list": self.on_list_resources,
            "resources/read": self.on_read_resource,
            "prompts/list": self.on_list_prompts,
            "prompts/get": self.on_get_prompt,
        }

        if hook := method_map.get(context.method):
            handler = partial(hook, call_next=handler)

        # We can assume that all intercepted calls are requests
        handler = partial(self.on_request, call_next=handler)

        return handler

    # Default implementations for all hooks
    async def on_request(self, context: MiddlewareContext[Any], call_next: NextFunctionT) -> Any:
        return await call_next(context)

    async def on_initialize(
        self, context: MiddlewareContext[InitializeRequestParams], call_next: NextFunctionT
    ) -> InitializeResult:
        return await call_next(context)

    async def on_call_tool(
        self, context: MiddlewareContext[CallToolRequestParams], call_next: NextFunctionT
    ) -> CallToolResult:
        return await call_next(context)

    async def on_read_resource(
        self, context: MiddlewareContext[ReadResourceRequestParams], call_next: NextFunctionT
    ) -> ReadResourceResult:
        return await call_next(context)

    async def on_get_prompt(
        self, context: MiddlewareContext[GetPromptRequestParams], call_next: NextFunctionT
    ) -> GetPromptResult:
        return await call_next(context)

    async def on_list_tools(
        self, context: MiddlewareContext[ListToolsRequest], call_next: NextFunctionT
    ) -> ListToolsResult:
        return await call_next(context)

    async def on_list_resources(
        self, context: MiddlewareContext[ListResourcesRequest], call_next: NextFunctionT
    ) -> ListResourcesResult:
        return await call_next(context)

    async def on_list_prompts(
        self, context: MiddlewareContext[ListPromptsRequest], call_next: NextFunctionT
    ) -> ListPromptsResult:
        return await call_next(context)


class MiddlewareManager:
    """Manages middleware callbacks for MCP requests."""

    def __init__(self):
        self.middlewares: list[Middleware] = []

    @telemetry("middleware_add")
    def add_middleware(self, callback: Middleware) -> None:
        """Add a middleware callback."""
        self.middlewares.append(callback)

    @telemetry("middleware_process_request")
    async def process_request(self, context: MiddlewareContext, original_call: Callable) -> MCPResponseContext:
        """
        Runs the full middleware chain, captures timing and errors,
        and returns a structured MCPResponseContext.
        """

        try:
            # Chain middleware callbacks
            async def execute_call(_: MiddlewareContext) -> Any:
                return await original_call()

            call_chain = execute_call
            for middleware in reversed(self.middlewares):
                call_chain = partial(middleware, call_next=call_chain)

            # Execute the chain
            start_time = time.time()

            # The result of the chain is the reaw result (e.g., CallToolResult)
            raw_result = await call_chain(context)

            # Success, now wrap the result in response context
            duration = time.time() - start_time

            response = MCPResponseContext.create(request_id=context.id, result=raw_result)
            response.duration = duration
            return response

        except Exception as error:
            duration = time.time() - context.timestamp
            response = MCPResponseContext.create(request_id=context.id, error=error)
            response.duration = duration
            return response


class CallbackClientSession:
    """ClientSession wrapper that uses callback-based middleware."""

    def __init__(self, client_session: ClientSession, connector_id: str, middleware_manager: MiddlewareManager):
        self._client_session = client_session
        self.connector_id = connector_id
        self.middleware_manager = middleware_manager

    async def _intercept_call(self, method_name: str, params: Any, original_call: Callable) -> Any:
        """
        Creates the context, runs it through the manager, and unwraps the final response.
        """
        context = MiddlewareContext(
            id=str(uuid.uuid4()),
            method=method_name,
            params=params,
            connection_id=self.connector_id,
            timestamp=time.time(),
        )

        # This now returns a rich MCPResponseContext
        response_context = await self.middleware_manager.process_request(context, original_call)

        # If there is an error, return it
        if response_context.error:
            raise response_context.error

        return response_context.result

    # Wrap all MCP methods with specific params
    async def initialize(self, *args, **kwargs) -> InitializeResult:
        return await self._intercept_call("initialize", None, lambda: self._client_session.initialize(*args, **kwargs))

    # List requests usually don't have parameters
    async def list_tools(self, *args, **kwargs) -> ListToolsResult:
        return await self._intercept_call("tools/list", None, lambda: self._client_session.list_tools(*args, **kwargs))

    async def call_tool(self, name: str, arguments: dict[str, Any], *args, **kwargs) -> CallToolResult:
        params = CallToolRequestParams(name=name, arguments=arguments)
        return await self._intercept_call(
            "tools/call", params, lambda: self._client_session.call_tool(params.name, params.arguments, *args, **kwargs)
        )

    async def list_resources(self, *args, **kwargs) -> ListResourcesResult:
        return await self._intercept_call(
            "resources/list", None, lambda: self._client_session.list_resources(*args, **kwargs)
        )

    async def read_resource(self, uri: str, *args, **kwargs) -> ReadResourceResult:
        params = ReadResourceRequestParams(uri=uri)
        return await self._intercept_call(
            "resources/read", params, lambda: self._client_session.read_resource(uri, *args, **kwargs)
        )

    async def list_prompts(self, *args, **kwargs) -> ListPromptsResult:
        return await self._intercept_call(
            "prompts/list", None, lambda: self._client_session.list_prompts(*args, **kwargs)
        )

    async def get_prompt(self, name: str, *args, **kwargs) -> GetPromptResult:
        params = GetPromptRequestParams(name=name, **kwargs)
        return await self._intercept_call(
            "prompts/get", params, lambda: self._client_session.get_prompt(name, *args, **kwargs)
        )

    def __getattr__(self, name: str) -> Any:
        """Delegate other attributes to the wrapped session."""
        return getattr(self._client_session, name)
