from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, TypeVar

from mcp.types import (
    CallToolResult,
    GetPromptResult,
    InitializeResult,
    ReadResourceResult,
    Tool,
)
from pydantic import AnyUrl

from mcp_use.client.connectors.base import BaseConnector
from mcp_use.client.middleware import Middleware, MiddlewareManager, MiddlewareContext
from mcp_use.logging import logger

T = TypeVar("T")


@dataclass
class Transforms:
    """All transformation config in one place."""

    prefix: str | None = None
    separator: str = "_"
    allowed_tools: list[str] | None = None
    disallowed_tools: list[str] | None = None
    middleware: list[Middleware] = field(default_factory=list)

    def merge(self, other: "Transforms") -> "Transforms":
        """Merge another set of transforms into this one.

        Prefixes are combined: older_prefix + separator + newer_prefix
        Filters are combined: intersection of allowed, union of disallowed.
        Middleware is concatenated.
        """
        # Prefix merging
        new_prefix = self.prefix
        if other.prefix:
            if self.prefix:
                new_prefix = f"{self.prefix}{self.separator}{other.prefix}"
            else:
                new_prefix = other.prefix

        # Allowed tools: Intersection
        new_allowed = self.allowed_tools
        if other.allowed_tools is not None:
            if self.allowed_tools is None:
                new_allowed = other.allowed_tools
            else:
                new_allowed = list(set(self.allowed_tools).intersection(other.allowed_tools))

        # Disallowed tools: Union
        new_disallowed = self.disallowed_tools
        if other.disallowed_tools is not None:
            if self.disallowed_tools is None:
                new_disallowed = other.disallowed_tools
            else:
                new_disallowed = list(set(self.disallowed_tools).union(other.disallowed_tools))

        # Middleware: Concatenate
        new_middleware = self.middleware + other.middleware

        return Transforms(
            prefix=new_prefix,
            separator=other.separator if other.separator != "_" else self.separator,
            allowed_tools=new_allowed,
            disallowed_tools=new_disallowed,
            middleware=new_middleware,
        )


class TransformedConnector(BaseConnector):
    """Wraps any connector and applies transformations."""

    def __init__(self, inner: BaseConnector, transforms: Transforms):
        # We don't initialize the base class fully because we delegate everything
        self._inner = inner
        self._transforms = transforms
        self._middleware_manager = MiddlewareManager()
        for mw in transforms.middleware:
            self._middleware_manager.add_middleware(mw)

    @property
    def inner(self) -> BaseConnector:
        """Get the underlying connector."""
        return self._inner

    @property
    def transforms(self) -> Transforms:
        """Get the applied transformations."""
        return self._transforms

    # --- Transformation Logic ---

    def _apply_prefix(self, name: str) -> str:
        if not self._transforms.prefix:
            return name
        return f"{self._transforms.prefix}{self._transforms.separator}{name}"

    def _strip_prefix(self, name: str) -> str:
        if not self._transforms.prefix:
            return name
        prefix_full = f"{self._transforms.prefix}{self._transforms.separator}"
        if name.startswith(prefix_full):
            return name[len(prefix_full) :]
        return name

    def _is_tool_allowed(self, name: str) -> bool:
        # Note: name here is the original name (after stripping prefix if applicable)
        if self._transforms.allowed_tools is not None:
            if name not in self._transforms.allowed_tools:
                return False
        if self._transforms.disallowed_tools is not None:
            if name in self._transforms.disallowed_tools:
                return False
        return True

    # --- Overridden methods ---

    async def list_tools(self) -> list[Tool]:
        """List tools from inner connector, applied filtering and prefixing."""
        tools = await self._inner.list_tools()

        filtered_tools = []
        for tool in tools:
            if self._is_tool_allowed(tool.name):
                # Create a new Tool object with the prefixed name
                # Tool is a pydantic model, so we can use model_copy
                new_tool = tool.model_copy(update={"name": self._apply_prefix(tool.name)})
                filtered_tools.append(new_tool)

        return filtered_tools

    async def call_tool(
        self,
        name: str,
        arguments: dict[str, Any],
        read_timeout_seconds: timedelta | None = None,
    ) -> CallToolResult:
        """Call a tool, stripping prefix and checking filters."""
        # If a prefix is set, we require the name to start with it
        if self._transforms.prefix:
            prefix_full = f"{self._transforms.prefix}{self._transforms.separator}"
            if not name.startswith(prefix_full):
                raise ValueError(
                    f"Tool '{name}' must be called with prefix '{prefix_full}'"
                )
            original_name = name[len(prefix_full):]
        else:
            original_name = name

        if not self._is_tool_allowed(original_name):
            raise ValueError(f"Tool '{name}' is not allowed by transformations.")

        # Prepare the call to inner
        async def do_call(ctx: MiddlewareContext) -> CallToolResult:
            return await self._inner.call_tool(original_name, arguments, read_timeout_seconds)

        # If we have transformation-specific middleware, run it
        if self._transforms.middleware:
            import uuid
            import time

            context = MiddlewareContext(
                id=str(uuid.uuid4()),
                method="tools/call",
                params={"name": original_name, "arguments": arguments},
                connection_id=self.public_identifier,
                timestamp=time.time(),
            )
            
            # Use process_request which returns MCPResponseContext
            response_context = await self._middleware_manager.process_request(context, do_call)
            if response_context.error:
                raise response_context.error
            return response_context.result
        else:
            return await do_call(None)

    # --- Delegated Properties and Methods ---

    @property
    def public_identifier(self) -> str:
        return self._inner.public_identifier

    @property
    def is_connected(self) -> bool:
        return self._inner.is_connected

    async def connect(self) -> None:
        await self._inner.connect()

    async def disconnect(self) -> None:
        await self._inner.disconnect()

    async def initialize(self) -> InitializeResult | None:
        return await self._inner.initialize()

    @property
    def capabilities(self):
        return self._inner.capabilities

    @property
    def client_session(self):
        return self._inner.client_session

    async def list_resources(self):
        return await self._inner.list_resources()

    async def read_resource(self, uri: AnyUrl):
        return await self._inner.read_resource(uri)

    async def list_prompts(self):
        return await self._inner.list_prompts()

    async def get_prompt(self, name: str, arguments: dict[str, Any] | None = None) -> GetPromptResult:
        return await self._inner.get_prompt(name, arguments)

    # Delegation for other items if needed via __getattr__
    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)

    # Chainable methods
    def with_prefix(self, prefix: str, separator: str = "_") -> "TransformedConnector":
        new_transforms = self._transforms.merge(Transforms(prefix=prefix, separator=separator))
        return TransformedConnector(self._inner, new_transforms)

    def with_tools(
        self, allowed: list[str] | None = None, disallowed: list[str] | None = None
    ) -> "TransformedConnector":
        new_transforms = self._transforms.merge(Transforms(allowed_tools=allowed, disallowed_tools=disallowed))
        return TransformedConnector(self._inner, new_transforms)

    def with_middleware(self, middleware: list[Middleware]) -> "TransformedConnector":
        new_transforms = self._transforms.merge(Transforms(middleware=middleware))
        return TransformedConnector(self._inner, new_transforms)
