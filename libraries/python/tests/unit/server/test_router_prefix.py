"""Unit tests for MCPRouter prefix handling.

Covers router-level prefixes declared on ``MCPRouter(prefix=...)``, composition
of prefixes for nested routers, and the existing call-site prefix behavior of
``MCPServer.include_router``.
"""

import pytest

from mcp_use.server import MCPRouter, MCPServer


async def _tool_names(server: MCPServer) -> list[str]:
    return sorted(tool.name for tool in await server.list_tools())


async def _prompt_names(server: MCPServer) -> list[str]:
    return sorted(prompt.name for prompt in await server.list_prompts())


@pytest.mark.asyncio
async def test_constructor_prefix_applied_to_tools_and_prompts():
    """A router-level prefix is applied when the router is included."""
    router = MCPRouter(prefix="math")

    @router.tool()
    def add(a: int, b: int) -> int:
        """Add two numbers."""
        return a + b

    @router.prompt()
    def greeting() -> str:
        return "hi"

    server = MCPServer(name="test")
    server.include_router(router)

    assert await _tool_names(server) == ["math_add"]
    assert await _prompt_names(server) == ["math_greeting"]


@pytest.mark.asyncio
async def test_nested_router_prefixes_composed_exactly_once():
    """Child and parent prefixes are composed once each, outermost first."""
    child = MCPRouter(prefix="child")

    @child.tool()
    def add(a: int, b: int) -> int:
        """Add two numbers."""
        return a + b

    @child.prompt()
    def greeting() -> str:
        return "child"

    parent = MCPRouter(prefix="parent")
    parent.include_router(child)

    @parent.tool()
    def multiply(a: int, b: int) -> int:
        """Multiply two numbers."""
        return a * b

    server = MCPServer(name="test")
    server.include_router(parent)

    assert await _tool_names(server) == ["parent_child_add", "parent_multiply"]
    assert await _prompt_names(server) == ["parent_child_greeting"]

    # Including a router must not rename its own pending items in place.
    assert [tool.name for tool in child.tools] == [None]


@pytest.mark.asyncio
async def test_call_site_prefix_behavior_unchanged():
    """An unprefixed router keeps honoring the call-site prefix."""
    router = MCPRouter()

    @router.tool()
    def add(a: int, b: int) -> int:
        """Add two numbers."""
        return a + b

    @router.prompt()
    def greeting() -> str:
        return "hi"

    server = MCPServer(name="test")
    server.include_router(router, prefix="math")

    assert await _tool_names(server) == ["math_add"]
    assert await _prompt_names(server) == ["math_greeting"]


@pytest.mark.asyncio
async def test_call_site_prefix_composes_with_router_prefix():
    """Call-site and router prefixes are composed outermost first."""
    router = MCPRouter(prefix="math")

    @router.tool()
    def add(a: int, b: int) -> int:
        """Add two numbers."""
        return a + b

    server = MCPServer(name="test")
    server.include_router(router, prefix="v1")

    assert await _tool_names(server) == ["v1_math_add"]


@pytest.mark.asyncio
async def test_routers_without_prefixes_unchanged():
    """Routers without any prefix keep their original names."""
    router = MCPRouter()

    @router.tool()
    def add(a: int, b: int) -> int:
        """Add two numbers."""
        return a + b

    @router.prompt()
    def greeting() -> str:
        return "hi"

    server = MCPServer(name="test")
    server.include_router(router)

    assert await _tool_names(server) == ["add"]
    assert await _prompt_names(server) == ["greeting"]


@pytest.mark.asyncio
async def test_nested_include_call_site_prefix_composes():
    """Mirrors the documented nested-router example."""
    arithmetic = MCPRouter()

    @arithmetic.tool()
    def add(a: int, b: int) -> int:
        """Add two numbers."""
        return a + b

    math_router = MCPRouter()
    math_router.include_router(arithmetic, prefix="arithmetic")

    @math_router.tool()
    def factorial(n: int) -> int:
        """Factorial."""
        return 1 if n <= 1 else n * factorial(n - 1)

    server = MCPServer(name="test")
    server.include_router(math_router, prefix="math")

    assert await _tool_names(server) == ["math_arithmetic_add", "math_factorial"]
