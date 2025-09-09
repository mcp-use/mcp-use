"""
Core middleware system implementation for MCP requests.

This module provides the fundamental middleware architecture including:
- Protocol definitions for type-safe middleware callbacks
- Request and response context classes
- Middleware manager for processing middleware chains
- Client session wrapper for intercepting MCP calls
"""

import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from mcp import ClientSession
from mcp.types import JSONRPCRequest, JSONRPCResponse


@dataclass
class MCPRequestContext:
    """Extended context for MCP requests with middleware metadata."""

    id: str
    method: str
    params: dict[str, Any]
    connector_id: str
    timestamp: float
    metadata: dict[str, Any]
    jsonrpc_request: JSONRPCRequest | None = None

    @classmethod
    def create(cls, method: str, params: dict[str, Any], connector_id: str) -> "MCPRequestContext":
        return cls(
            id=str(uuid.uuid4()),
            method=method,
            params=params,
            connector_id=connector_id,
            timestamp=time.time(),
            metadata={},
        )


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


# Protocol definitions for middleware


class NextFunctionT(Protocol):
    """Protocol for the next() function passed to middleware."""

    async def __call__(self) -> Any: ...


class MiddlewareCallbackT(Protocol):
    """Protocol for middleware callbacks.

    Args:
        request: The MCP request context with metadata
        call_next: Function to call the next middleware or original handler

    Returns:
        The result from the middleware chain
    """

    async def __call__(self, request: MCPRequestContext, call_next: NextFunctionT) -> Any: ...


class MiddlewareManager:
    """Manages middleware callbacks for MCP requests."""

    def __init__(self):
        self.middleware_callbacks: list[MiddlewareCallbackT] = []

    def add_middleware(self, callback: MiddlewareCallbackT) -> None:
        """Add a middleware callback."""
        self.middleware_callbacks.append(callback)

    async def process_request(self, request: MCPRequestContext, original_call: Callable) -> MCPResponseContext:
        """Process a request through all middleware."""

        try:
            # Chain middleware callbacks
            async def execute_call():
                return await original_call()

            call_chain = execute_call
            for middleware in reversed(self.middleware_callbacks):
                current_call = call_chain

                async def wrapped_call(middleware=middleware, current_call=current_call):
                    return await middleware(request, current_call)

                call_chain = wrapped_call

            # Execute the chain
            start_time = time.time()
            result = await call_chain()
            duration = time.time() - start_time

            response = MCPResponseContext.create(request.id, result=result)
            response.duration = duration
            return response

        except Exception as error:
            duration = time.time() - request.timestamp
            response = MCPResponseContext.create(request.id, error=error)
            response.duration = duration
            raise error


class CallbackClientSession:
    """ClientSession wrapper that uses callback-based middleware."""

    def __init__(self, client_session: ClientSession, connector_id: str, middleware_manager: MiddlewareManager):
        self._client_session = client_session
        self.connector_id = connector_id
        self.middleware_manager = middleware_manager

    async def _intercept_call(self, method_name: str, original_method: Callable, *args, **kwargs) -> Any:
        """Intercept method calls through middleware."""
        request = MCPRequestContext.create(method_name, {"args": args, "kwargs": kwargs}, self.connector_id)

        async def original_call():
            return await original_method(*args, **kwargs)

        response = await self.middleware_manager.process_request(request, original_call)
        return response.result

    # Wrap all MCP methods
    async def initialize(self, *args, **kwargs):
        return await self._intercept_call("initialize", self._client_session.initialize, *args, **kwargs)

    async def list_tools(self, *args, **kwargs):
        return await self._intercept_call("tools/list", self._client_session.list_tools, *args, **kwargs)

    async def call_tool(self, *args, **kwargs):
        return await self._intercept_call("tools/call", self._client_session.call_tool, *args, **kwargs)

    async def list_resources(self, *args, **kwargs):
        return await self._intercept_call("resources/list", self._client_session.list_resources, *args, **kwargs)

    async def read_resource(self, *args, **kwargs):
        return await self._intercept_call("resources/read", self._client_session.read_resource, *args, **kwargs)

    async def list_prompts(self, *args, **kwargs):
        return await self._intercept_call("prompts/list", self._client_session.list_prompts, *args, **kwargs)

    async def get_prompt(self, *args, **kwargs):
        return await self._intercept_call("prompts/get", self._client_session.get_prompt, *args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        """Delegate other attributes to the wrapped session."""
        return getattr(self._client_session, name)
