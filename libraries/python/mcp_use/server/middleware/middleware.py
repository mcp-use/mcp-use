from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from datetime import datetime
from functools import partial
from typing import Any, Generic, Protocol, TypeVar, runtime_checkable

from mcp.types import (
    CallToolRequestParams,
    GetPromptRequestParams,
    InitializeRequestParams,
    PaginatedRequestParams,
    ReadResourceRequestParams,
)

T = TypeVar("T")
R = TypeVar("R")


@dataclass(kw_only=True, frozen=True)
class ServerMiddlewareContext(Generic[T]):
    """Immutable context passed through server middleware pipeline."""

    message: T
    method: str
    timestamp: datetime
    transport: str
    session_id: str | None = None
    headers: dict[str, str] | None = None
    client_ip: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def copy(self, **kwargs: Any) -> ServerMiddlewareContext[T]:
        return replace(self, **kwargs)


@dataclass
class ServerResponseContext(Generic[R]):
    """Optional response wrapper for middleware outputs."""

    result: R | None = None
    error: Exception | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class CallNext(Protocol[T, R]):
    def __call__(self, context: ServerMiddlewareContext[T]) -> Awaitable[R]: ...


class Middleware:
    async def __call__(self, context: ServerMiddlewareContext[T], call_next: CallNext[T, Any]) -> Any:
        handler_chain = await self._dispatch_handler(context, call_next)
        return await handler_chain(context)

    async def _dispatch_handler(
        self, context: ServerMiddlewareContext[Any], call_next: CallNext[Any, Any]
    ) -> CallNext[Any, Any]:
        handler: CallNext[Any, Any] = call_next

        # Note: "initialize" is not handled here - it occurs at the protocol layer
        # before middleware is invoked. See ServerSession._received_request in the MCP SDK.
        match context.method:
            case "initialize":
                handler = partial(self.on_initialize, call_next=handler)
            case "tools/call":
                handler = partial(self.on_call_tool, call_next=handler)
            case "resources/read":
                handler = partial(self.on_read_resource, call_next=handler)
            case "prompts/get":
                handler = partial(self.on_get_prompt, call_next=handler)
            case "tools/list":
                handler = partial(self.on_list_tools, call_next=handler)
            case "resources/list":
                handler = partial(self.on_list_resources, call_next=handler)
            case "prompts/list":
                handler = partial(self.on_list_prompts, call_next=handler)

        handler = partial(self.on_request, call_next=handler)
        return handler

    async def on_request(self, context: ServerMiddlewareContext[Any], call_next: CallNext[Any, Any]) -> Any:
        return await call_next(context)

    async def on_initialize(
        self,
        context: ServerMiddlewareContext[InitializeRequestParams],
        call_next: CallNext[InitializeRequestParams, Any],
    ) -> Any:
        return await call_next(context)

    async def on_call_tool(
        self,
        context: ServerMiddlewareContext[CallToolRequestParams],
        call_next: CallNext[CallToolRequestParams, Any],
    ) -> Any:
        return await call_next(context)

    async def on_read_resource(
        self,
        context: ServerMiddlewareContext[ReadResourceRequestParams],
        call_next: CallNext[ReadResourceRequestParams, Any],
    ) -> Any:
        return await call_next(context)

    async def on_get_prompt(
        self,
        context: ServerMiddlewareContext[GetPromptRequestParams],
        call_next: CallNext[GetPromptRequestParams, Any],
    ) -> Any:
        return await call_next(context)

    async def on_list_tools(
        self,
        context: ServerMiddlewareContext[PaginatedRequestParams | None],
        call_next: CallNext[PaginatedRequestParams | None, Any],
    ) -> Any:
        return await call_next(context)

    async def on_list_resources(
        self,
        context: ServerMiddlewareContext[PaginatedRequestParams | None],
        call_next: CallNext[PaginatedRequestParams | None, Any],
    ) -> Any:
        return await call_next(context)

    async def on_list_prompts(
        self,
        context: ServerMiddlewareContext[PaginatedRequestParams | None],
        call_next: CallNext[PaginatedRequestParams | None, Any],
    ) -> Any:
        return await call_next(context)


class MiddlewareManager:
    def __init__(self) -> None:
        self.middlewares: list[Middleware] = []

    def add_middleware(self, middleware: Middleware) -> None:
        self.middlewares.append(middleware)

    async def process_request(
        self, context: ServerMiddlewareContext[Any], handler: Callable[[ServerMiddlewareContext[Any]], Awaitable[Any]]
    ) -> Any:
        chain = handler
        for middleware in reversed(self.middlewares):
            chain = partial(middleware, call_next=chain)

        return await chain(context)
