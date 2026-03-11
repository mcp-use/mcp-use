from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from mcp.types import (
    CallToolResult,
    GetPromptResult,
    InitializeResult,
    Prompt,
    ReadResourceResult,
    Resource,
    Tool,
)

from mcp_use.client.middleware import Middleware

if TYPE_CHECKING:
    from mcp_use.server.server import MCPServer


@runtime_checkable
class Connector(Protocol):
    @property
    def name(self) -> str: ...

    @property
    def is_connected(self) -> bool: ...

    async def connect(self) -> None: ...

    async def disconnect(self) -> None: ...

    async def initialize(self) -> InitializeResult: ...

    async def list_tools(self) -> list[Tool]: ...

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> CallToolResult: ...

    async def list_resources(self) -> list[Resource]: ...

    async def read_resource(self, uri: str) -> ReadResourceResult: ...

    async def list_prompts(self) -> list[Prompt]: ...

    async def get_prompt(self, name: str, arguments: dict[str, Any] | None) -> GetPromptResult: ...

    # Transformations
    def with_prefix(self, prefix: str) -> Connector: ...

    def with_tools(self, allowed: list[str] | None, disallowed: list[str] | None) -> Connector: ...

    def with_middleware(self, middleware: list[Middleware]) -> Connector: ...

    # Server transformation
    def as_server(self, name: str | None = None) -> MCPServer: ...
