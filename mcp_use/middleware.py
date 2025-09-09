"""
Flexible callback-based middleware system for MCP requests.

This provides a simple, developer-friendly way to intercept and process
MCP requests using standard callback patterns.
"""

import asyncio
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

from mcp import ClientSession
from mcp.types import JSONRPCRequest, JSONRPCResponse

from .logging import logger


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


# Protocol definitions for strict typing of middleware callbacks following MCP package conventions


class NextFunctionT(Protocol):
    """Protocol for the next() function passed to middleware."""

    async def __call__(self) -> Any: ...


class BeforeRequestCallbackT(Protocol):
    """Protocol for before-request middleware callbacks."""

    def __call__(self, request: MCPRequestContext) -> None | MCPRequestContext: ...


class AfterRequestCallbackT(Protocol):
    """Protocol for after-request middleware callbacks."""

    def __call__(self, request: MCPRequestContext, response: MCPResponseContext) -> None | MCPResponseContext: ...


class OnErrorCallbackT(Protocol):
    """Protocol for error handling middleware callbacks."""

    def __call__(self, request: MCPRequestContext, error: Exception) -> None: ...


class MiddlewareCallbackT(Protocol):
    """Protocol for Express.js-style middleware callbacks.

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
        self.before_callbacks: list[BeforeRequestCallbackT] = []
        self.after_callbacks: list[AfterRequestCallbackT] = []
        self.error_callbacks: list[OnErrorCallbackT] = []
        self.middleware_callbacks: list[MiddlewareCallbackT] = []

    def add_before_request(self, callback: BeforeRequestCallbackT) -> None:
        """Add a callback to run before each request."""
        self.before_callbacks.append(callback)

    def add_after_request(self, callback: AfterRequestCallbackT) -> None:
        """Add a callback to run after each request."""
        self.after_callbacks.append(callback)

    def add_on_error(self, callback: OnErrorCallbackT) -> None:
        """Add a callback to run when requests fail."""
        self.error_callbacks.append(callback)

    def add_middleware(self, callback: MiddlewareCallbackT) -> None:
        """Add a combined middleware callback."""
        self.middleware_callbacks.append(callback)

    async def process_request(self, request: MCPRequestContext, original_call: Callable) -> MCPResponseContext:
        """Process a request through all middleware."""

        try:
            # Before request callbacks
            for callback in self.before_callbacks:
                result = callback(request)
                if result is not None:
                    request = result

            # Combined middleware callbacks (Express.js style)
            async def execute_call():
                return await original_call()

            # Chain middleware callbacks
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

            # After request callbacks
            for callback in self.after_callbacks:
                callback_result = callback(request, response)
                if callback_result is not None:
                    response = callback_result

            return response

        except Exception as error:
            duration = time.time() - request.timestamp
            response = MCPResponseContext.create(request.id, error=error)
            response.duration = duration

            # Error callbacks
            for callback in self.error_callbacks:
                callback(request, error)

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


# Convenience functions for common middleware patterns
def create_logging_middleware(detailed: bool = False) -> MiddlewareCallbackT:
    """Create a logging middleware callback."""

    async def logging_middleware(request: MCPRequestContext, call_next: NextFunctionT) -> Any:
        if detailed:
            logger.info(f"[{request.id}] {request.connector_id} -> {request.method} with {request.params}")
        else:
            logger.info(f"[{request.id}] {request.connector_id} -> {request.method}")

        try:
            result = await call_next()
            duration = time.time() - request.timestamp

            if detailed and result:
                result_str = str(result)[:200] + ("..." if len(str(result)) > 200 else "")
                logger.info(
                    f"[{request.id}] {request.connector_id} <- {request.method} ({duration:.3f}s): {result_str}"
                )
            else:
                logger.info(f"[{request.id}] {request.connector_id} <- {request.method} ({duration:.3f}s)")

            return result
        except Exception as e:
            duration = time.time() - request.timestamp
            logger.error(f"[{request.id}] {request.connector_id} <- {request.method} FAILED ({duration:.3f}s): {e}")
            raise

    return logging_middleware


def create_metrics_middleware() -> tuple[MiddlewareCallbackT, Callable]:
    """Create a metrics middleware callback and getter function."""
    metrics = {"total_requests": 0, "total_errors": 0, "method_counts": {}, "method_durations": {}}

    lock = asyncio.Lock()

    async def metrics_middleware(request: MCPRequestContext, call_next: NextFunctionT) -> Any:
        async with lock:
            metrics["total_requests"] += 1
            metrics["method_counts"][request.method] = metrics["method_counts"].get(request.method, 0) + 1

        try:
            result = await call_next()
            duration = time.time() - request.timestamp

            async with lock:
                if request.method not in metrics["method_durations"]:
                    metrics["method_durations"][request.method] = []
                metrics["method_durations"][request.method].append(duration)

            return result
        except Exception:
            async with lock:
                metrics["total_errors"] += 1
                if request.method not in metrics["method_durations"]:
                    metrics["method_durations"][request.method] = []
                metrics["method_durations"][request.method].append(time.time() - request.timestamp)
            raise

    def get_metrics() -> dict[str, Any]:
        return {
            **metrics,
            "method_avg_duration": {
                method: sum(durations) / len(durations) if durations else 0
                for method, durations in metrics["method_durations"].items()
            },
        }

    return metrics_middleware, get_metrics
