"""
Regression tests for MCPServer.include_router prefix behaviour.

Covers: https://github.com/mcp-use/mcp-use/issues/1438
Bug: include_router(prefix=...) applied the prefix to tools and prompts but
     silently dropped it for resources (resource.name was used instead of the
     computed resource_name variable).
"""

import pytest

from mcp_use.server import MCPRouter, MCPServer


@pytest.fixture()
def router() -> MCPRouter:
    r = MCPRouter()

    @r.tool()
    def add(a: int, b: int) -> int:
        return a + b

    @r.resource(uri="config://app", name="get_config")
    def get_config() -> str:
        return "{}"

    @r.prompt()
    def greet(name: str) -> str:
        return f"Hello, {name}!"

    return r


class TestIncludeRouterPrefix:
    """include_router(prefix=...) must apply the prefix to tools, resources, AND prompts."""

    @pytest.mark.asyncio
    async def test_tool_gets_prefix(self, router: MCPRouter):
        server = MCPServer(name="test-server")
        server.include_router(router, prefix="math")

        tools = await server.list_tools()
        names = [t.name for t in tools]
        assert "math_add" in names
        assert "add" not in names

    @pytest.mark.asyncio
    async def test_resource_gets_prefix(self, router: MCPRouter):
        server = MCPServer(name="test-server")
        server.include_router(router, prefix="math")

        resources = await server.list_resources()
        names = [r.name for r in resources]
        assert "math_get_config" in names
        assert "get_config" not in names

    @pytest.mark.asyncio
    async def test_prompt_gets_prefix(self, router: MCPRouter):
        server = MCPServer(name="test-server")
        server.include_router(router, prefix="math")

        prompts = await server.list_prompts()
        names = [p.name for p in prompts]
        assert "math_greet" in names
        assert "greet" not in names

    @pytest.mark.asyncio
    async def test_no_prefix_leaves_names_unchanged(self, router: MCPRouter):
        server = MCPServer(name="test-server")
        server.include_router(router)

        tools = await server.list_tools()
        resources = await server.list_resources()
        prompts = await server.list_prompts()

        assert any(t.name == "add" for t in tools)
        assert any(r.name == "get_config" for r in resources)
        assert any(p.name == "greet" for p in prompts)

    @pytest.mark.asyncio
    async def test_resource_name_none_falls_back_to_function_name_with_prefix(self):
        """When resource name is None, the function name should be used as the base."""
        r = MCPRouter()

        @r.resource(uri="config://app")
        def my_config() -> str:
            return "{}"

        server = MCPServer(name="test-server")
        server.include_router(r, prefix="ns")

        resources = await server.list_resources()
        names = [res.name for res in resources]
        assert "ns_my_config" in names
