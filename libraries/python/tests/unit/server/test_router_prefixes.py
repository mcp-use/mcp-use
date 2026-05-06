from mcp_use.server import MCPRouter, MCPServer


def test_server_include_router_prefixes_resources_like_tools_and_prompts():
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

    server = MCPServer(name="test-server")
    server.include_router(router, prefix="math")

    assert [tool.name for tool in server._tool_manager.list_tools()] == ["math_add"]
    assert [resource.name for resource in server._resource_manager.list_resources()] == ["math_get_config"]
    assert [prompt.name for prompt in server._prompt_manager.list_prompts()] == ["math_greet"]


def test_nested_router_prefixes_resource_names():
    child = MCPRouter()

    @child.resource("config://app")
    def get_config() -> str:
        return "cfg"

    parent = MCPRouter()
    parent.include_router(child, prefix="math")

    assert [resource.name for resource in parent.resources] == ["math_get_config"]
