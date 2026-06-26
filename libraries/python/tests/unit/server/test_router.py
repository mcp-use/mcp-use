"""Unit tests for ``MCPServer.include_router`` registration.

These tests cover the prefixing logic for tools, resources, and prompts
registered via an :class:`MCPRouter`. Resources previously had a regression
where the computed ``resource_name`` was discarded and the original
(unprefixed) name was registered instead — see the regression test below.
"""

from mcp_use.server import MCPRouter, MCPServer


def _make_router() -> MCPRouter:
    """Build a router with one tool, one resource, and one prompt."""
    router = MCPRouter()

    @router.tool()
    def add(a: int, b: int) -> int:
        return a + b

    @router.resource("config://app")
    def get_config() -> str:
        return "app config"

    @router.prompt()
    def greet(name: str) -> str:
        return f"Hello {name}"

    return router


def _registered(server: MCPServer) -> tuple[set[str], set[str], set[str]]:
    """Return the names of currently registered tools, resources, prompts."""
    tools = {t.name for t in server._tool_manager.list_tools()}
    resources = {r.name for r in server._resource_manager.list_resources()}
    prompts = {p.name for p in server._prompt_manager.list_prompts()}
    return tools, resources, prompts


class TestIncludeRouterPrefix:
    """Tools, resources, and prompts are all prefixed consistently."""

    def test_tools_get_prefix(self):
        server = MCPServer(name="t")
        server.include_router(_make_router(), prefix="math")
        tools, _, _ = _registered(server)
        assert "math_add" in tools

    def test_resources_get_prefix(self):
        """Regression: resource name was being passed through unprefixed.

        Before the fix, line 322 in server.py passed ``name=resource.name``
        instead of the computed ``resource_name``, so a resource registered
        via a router with ``prefix="math"`` ended up under its bare name
        (``get_config``) instead of the prefixed one (``math_get_config``).
        """
        server = MCPServer(name="t")
        server.include_router(_make_router(), prefix="math")
        _, resources, _ = _registered(server)
        assert "math_get_config" in resources
        assert "get_config" not in resources

    def test_prompts_get_prefix(self):
        server = MCPServer(name="t")
        server.include_router(_make_router(), prefix="math")
        _, _, prompts = _registered(server)
        assert "math_greet" in prompts


class TestIncludeRouterNoPrefix:
    """Without a prefix, names match the underlying callable / declared name."""

    def test_no_prefix_uses_function_names(self):
        server = MCPServer(name="t")
        server.include_router(_make_router())
        tools, resources, prompts = _registered(server)
        assert "add" in tools
        assert "get_config" in resources
        assert "greet" in prompts


class TestIncludeRouterDisabled:
    """``enabled=False`` skips registration entirely."""

    def test_disabled_router_registers_nothing(self):
        server = MCPServer(name="t")
        before = _registered(server)
        server.include_router(_make_router(), prefix="math", enabled=False)
        after = _registered(server)
        assert before == after


class TestIncludeRouterExplicitNames:
    """Explicit ``name=`` on a router primitive is also prefixed."""

    def test_explicit_resource_name_is_prefixed(self):
        router = MCPRouter()

        @router.resource("config://app", name="cfg")
        def _resource() -> str:
            return "ok"

        server = MCPServer(name="t")
        server.include_router(router, prefix="math")
        _, resources, _ = _registered(server)
        assert "math_cfg" in resources
