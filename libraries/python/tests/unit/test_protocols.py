from __future__ import annotations

from typing import Any

import httpx
import pytest
from mcp.types import (
    CallToolResult,
    GetPromptResult,
    Implementation,
    InitializeResult,
    Prompt,
    ReadResourceResult,
    Resource,
    Tool,
)

from mcp_use.client.exceptions import ToolNameCollisionError, ToolNotFoundError
from mcp_use.client.middleware import Middleware
from mcp_use.protocols import Auth, Connector
from mcp_use.server.server import MCPServer


class MockConnector:
    @property
    def name(self) -> str:
        return "mock"

    @property
    def is_connected(self) -> bool:
        return True

    async def connect(self) -> None:
        pass

    async def disconnect(self) -> None:
        pass

    async def initialize(self) -> InitializeResult:
        return InitializeResult(
            protocolVersion="2024-11-05", capabilities={}, serverInfo=Implementation(name="test", version="1.0.0")
        )

    async def list_tools(self) -> list[Tool]:
        return []

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> CallToolResult:
        return CallToolResult(content=[], isError=False)

    async def list_resources(self) -> list[Resource]:
        return []

    async def read_resource(self, uri: str) -> ReadResourceResult:
        return ReadResourceResult(contents=[])

    async def list_prompts(self) -> list[Prompt]:
        return []

    async def get_prompt(self, name: str, arguments: dict[str, Any] | None) -> GetPromptResult:
        return GetPromptResult(description="test", messages=[])

    def with_prefix(self, prefix: str) -> Connector:
        return self

    def with_tools(self, allowed: list[str] | None, disallowed: list[str] | None) -> Connector:
        return self

    def with_middleware(self, middleware: list[Middleware]) -> Connector:
        return self

    def as_server(self, name: str | None = None) -> MCPServer:
        return MCPServer(name=name)


class MockAuth:
    def apply_to_request(self, request: httpx.Request) -> httpx.Request:
        return request

    async def refresh(self) -> None:
        pass

    @property
    def is_expired(self) -> bool:
        return False


def test_connector_protocol_compliance():
    mock = MockConnector()
    assert isinstance(mock, Connector)


def test_auth_protocol_compliance():
    mock = MockAuth()
    assert isinstance(mock, Auth)


def test_exceptions_exist():
    with pytest.raises(ToolNotFoundError):
        raise ToolNotFoundError("not found")

    with pytest.raises(ToolNameCollisionError):
        raise ToolNameCollisionError("collision")
