"""Router prefix propagation for tools, resources and prompts.

``include_router(..., prefix=...)`` is documented as applying to every item a
router carries.  These tests pin that behaviour for resources, which used to
keep their unprefixed name because the computed name was thrown away.
"""

from __future__ import annotations

import pytest

from mcp_use.server import MCPRouter, MCPServer


def _build_router() -> MCPRouter:
    router = MCPRouter()

    @router.tool()
    def add(a: int, b: int) -> int:
        """Add two numbers."""
        return a + b

    @router.resource(uri="config://app")
    def get_config() -> str:
        """App config."""
        return '{"setting": "value"}'

    @router.prompt()
    def greeting(name: str) -> str:
        """Greet someone."""
        return f"Hello, {name}"

    return router


@pytest.mark.asyncio
async def test_include_router_prefixes_all_item_kinds() -> None:
    server = MCPServer(name="prefix-test")
    server.include_router(_build_router(), prefix="math")

    tools = await server.list_tools()
    resources = await server.list_resources()
    prompts = await server.list_prompts()

    assert [tool.name for tool in tools] == ["math_add"]
    assert [resource.name for resource in resources] == ["math_get_config"]
    assert [str(resource.uri) for resource in resources] == ["config://app"]
    assert [prompt.name for prompt in prompts] == ["math_greeting"]


@pytest.mark.asyncio
async def test_include_router_without_prefix_keeps_names() -> None:
    server = MCPServer(name="prefix-test")
    server.include_router(_build_router())

    tools = await server.list_tools()
    resources = await server.list_resources()

    assert [tool.name for tool in tools] == ["add"]
    assert [resource.name for resource in resources] == ["get_config"]


@pytest.mark.asyncio
async def test_nested_router_prefixes_resources() -> None:
    parent = MCPRouter()
    parent.include_router(_build_router(), prefix="math")

    server = MCPServer(name="prefix-test")
    server.include_router(parent)

    resources = await server.list_resources()
    prompts = await server.list_prompts()

    assert [resource.name for resource in resources] == ["math_get_config"]
    assert [prompt.name for prompt in prompts] == ["math_greeting"]
