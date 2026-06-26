"""Tests for MCPServer.include_router name prefixing."""

from mcp_use.server import MCPRouter, MCPServer


def test_include_router_prefixes_tools_resources_and_prompts():
    router = MCPRouter()

    @router.tool()
    def add(a: int, b: int) -> int:
        return a + b

    @router.resource("config://app")
    def get_config() -> str:
        return "cfg"

    @router.prompt()
    def greet(name: str) -> str:
        return f"Hi {name}"

    server = MCPServer(name="t")
    server.include_router(router, prefix="math")

    tool_names = [t.name for t in server._tool_manager.list_tools()]
    resource_names = [r.name for r in server._resource_manager.list_resources()]
    prompt_names = [p.name for p in server._prompt_manager.list_prompts()]

    # Resources must be prefixed consistently with tools and prompts; before the
    # fix the resource kept its unprefixed name.
    assert tool_names == ["math_add"]
    assert resource_names == ["math_get_config"]
    assert prompt_names == ["math_greet"]


def test_include_router_without_prefix_keeps_names():
    router = MCPRouter()

    @router.resource("config://app")
    def get_config() -> str:
        return "cfg"

    server = MCPServer(name="t")
    server.include_router(router)

    resource_names = [r.name for r in server._resource_manager.list_resources()]
    assert resource_names == ["get_config"]
