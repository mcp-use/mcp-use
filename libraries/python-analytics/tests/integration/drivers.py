"""Real MCP clients (mcp 1.x ``ClientSession``, mcp 2.x ``Client``) behind one small interface.

Each method performs one request and returns what the client observed: a
result (``success``), a result with ``isError`` (``tool_error``) or a JSON-RPC
error with its code (``error``).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from importlib import metadata
from typing import Any

from harness import Seen

MCP_MAJOR = int(metadata.version("mcp").split(".")[0])


def _text(result: Any) -> str | None:
    parts = [getattr(block, "text", None) for block in getattr(result, "content", None) or []]
    return "\n".join(part for part in parts if part)[:500] or None


class V1Driver:
    """Wraps an initialized mcp 1.x ``ClientSession``."""

    def __init__(self, session: Any) -> None:
        self.session = session

    async def _observe(self, method: str, target: str | None, call: Any) -> Seen:
        from mcp.shared.exceptions import McpError

        try:
            result = await call
        except McpError as error:
            return Seen(method, target, "error", error.error.code, error.error.message[:500] or None)
        if getattr(result, "isError", False):
            return Seen(method, target, "tool_error", message=_text(result))
        return Seen(method, target)

    async def list_tools(self) -> Seen:
        return await self._observe("tools/list", None, self.session.list_tools())

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Seen:
        return await self._observe("tools/call", name, self.session.call_tool(name, arguments))

    async def read_resource(self, uri: str) -> Seen:
        from pydantic import AnyUrl

        return await self._observe("resources/read", uri, self.session.read_resource(AnyUrl(uri)))

    async def get_prompt(self, name: str, arguments: dict[str, str]) -> Seen:
        return await self._observe("prompts/get", name, self.session.get_prompt(name, arguments))


class V2Driver:
    """Wraps a connected mcp 2.x ``Client``."""

    def __init__(self, client: Any) -> None:
        self.client = client

    async def _observe(self, method: str, target: str | None, call: Any) -> Seen:
        from mcp.shared.exceptions import MCPError

        try:
            result = await call
        except MCPError as error:
            return Seen(method, target, "error", error.code, error.message[:500] or None)
        if getattr(result, "is_error", False):
            return Seen(method, target, "tool_error", message=_text(result))
        return Seen(method, target)

    async def list_tools(self) -> Seen:
        return await self._observe("tools/list", None, self.client.list_tools())

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Seen:
        return await self._observe("tools/call", name, self.client.call_tool(name, arguments))

    async def read_resource(self, uri: str) -> Seen:
        return await self._observe("resources/read", uri, self.client.read_resource(uri))

    async def get_prompt(self, name: str, arguments: dict[str, str]) -> Seen:
        return await self._observe("prompts/get", name, self.client.get_prompt(name, arguments))


def _implementation(name: str) -> Any:
    from mcp.types import Implementation

    return Implementation(name=name, version="1.0.0")


@asynccontextmanager
async def v1_http(url: str, client_name: str, headers: dict[str, str] | None = None) -> AsyncIterator[V1Driver]:
    """mcp 1.x ``ClientSession`` over streamable HTTP."""
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    async with streamablehttp_client(url, headers=headers) as (read, write, _):
        async with ClientSession(read, write, client_info=_implementation(client_name)) as session:
            await session.initialize()
            yield V1Driver(session)


@asynccontextmanager
async def v1_sse(url: str, client_name: str, headers: dict[str, str] | None = None) -> AsyncIterator[V1Driver]:
    """mcp 1.x ``ClientSession`` over the legacy SSE transport."""
    from mcp import ClientSession
    from mcp.client.sse import sse_client

    async with sse_client(url, headers=headers) as (read, write):
        async with ClientSession(read, write, client_info=_implementation(client_name)) as session:
            await session.initialize()
            yield V1Driver(session)


@asynccontextmanager
async def v1_memory(lowlevel_server: Any, client_name: str) -> AsyncIterator[V1Driver]:
    """mcp 1.x in-memory streams: ``Server.run`` without any HTTP (like stdio)."""
    from mcp.shared.memory import create_connected_server_and_client_session

    async with create_connected_server_and_client_session(
        lowlevel_server, client_info=_implementation(client_name)
    ) as session:
        yield V1Driver(session)


@asynccontextmanager
async def v2_http(
    url: str, client_name: str, headers: dict[str, str] | None = None, mode: str = "legacy"
) -> AsyncIterator[V2Driver]:
    """mcp 2.x ``Client`` over streamable HTTP; ``mode="legacy"`` forces the initialize handshake."""
    from mcp import Client
    from mcp.client.streamable_http import streamable_http_client
    from mcp.shared._httpx_utils import create_mcp_http_client

    transport = streamable_http_client(url, http_client=create_mcp_http_client(headers=headers))
    async with Client(transport, client_info=_implementation(client_name), mode=mode, cache=None) as client:
        yield V2Driver(client)


@asynccontextmanager
async def v2_memory(server: Any, client_name: str, mode: str = "legacy") -> AsyncIterator[V2Driver]:
    """mcp 2.x in-process ``Client``."""
    from mcp import Client

    async with Client(server, client_info=_implementation(client_name), mode=mode, cache=None) as client:
        yield V2Driver(client)
