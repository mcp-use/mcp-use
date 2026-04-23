"""Unit tests for mounted connector support on MCPServer."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from mcp.types import (
    CallToolRequest,
    CallToolResult,
    ListToolsRequest,
    ListToolsResult,
    ServerResult,
    TextContent,
    Tool,
)

from mcp_use.client.connectors.base import BaseConnector
from mcp_use.server import MCPServer
from mcp_use.server.runner import ServerRunner


def _make_tool(name: str) -> Tool:
    return Tool(
        name=name,
        description=f"{name} description",
        inputSchema={"type": "object", "properties": {}},
    )


def _make_call_tool_result(text: str) -> CallToolResult:
    return CallToolResult(content=[TextContent(type="text", text=text)])


def _unwrap_server_result(result):
    return getattr(result, "root", result)


def _make_connector(tool_names: list[str], tool_result: CallToolResult | None = None) -> Mock:
    connector = Mock(spec=BaseConnector)
    connector.connect = AsyncMock()
    connector.initialize = AsyncMock()
    connector.disconnect = AsyncMock()
    connector.list_tools = AsyncMock(return_value=[_make_tool(name) for name in tool_names])
    connector.call_tool = AsyncMock(return_value=tool_result or _make_call_tool_result("mounted"))
    connector.public_identifier = "mock://connector"
    return connector


class TestMountRegistration:
    def test_mount_stores_connector(self):
        server = MCPServer(name="test")
        connector = _make_connector(["click"])

        server.mount(connector, prefix="browser")

        assert server._mounted_connectors == [("browser", connector)]

    def test_mount_strips_surrounding_whitespace_from_prefix(self):
        server = MCPServer(name="test")
        connector = _make_connector(["click"])

        server.mount(connector, prefix=" browser ")

        assert server._mounted_connectors == [("browser", connector)]

    @pytest.mark.parametrize(
        ("prefix", "expected_prefix"),
        [
            ("browser-tools", "browser_tools"),
            ("browser tools", "browser_tools"),
            ("browser.tools", "browser_tools"),
            ("_browser", "browser"),
            ("browser_", "browser"),
            ("__browser__", "browser"),
        ],
    )
    def test_mount_sanitizes_prefixes_to_provider_compatible_tool_names(self, prefix: str, expected_prefix: str):
        server = MCPServer(name="test")
        connector = _make_connector(["click"])

        server.mount(connector, prefix=prefix)

        assert server._mounted_connectors == [(expected_prefix, connector)]

    def test_mount_rejects_empty_prefix(self):
        server = MCPServer(name="test")
        connector = _make_connector(["click"])

        with pytest.raises(ValueError, match="non-empty"):
            server.mount(connector, prefix=" ")

    def test_mount_rejects_prefixes_that_sanitize_to_empty(self):
        server = MCPServer(name="test")
        connector = _make_connector(["click"])

        with pytest.raises(ValueError, match="at least one letter or number"):
            server.mount(connector, prefix="---")

    def test_mount_truncates_prefixes_longer_than_64_characters(self):
        server = MCPServer(name="test")
        connector = _make_connector(["click"])

        server.mount(connector, prefix="a" * 65)

        assert server._mounted_connectors == [("a" * 64, connector)]

    def test_mount_rejects_duplicate_prefix_after_sanitization(self):
        server = MCPServer(name="test")
        server.mount(_make_connector(["click"]), prefix="browser-tools")

        with pytest.raises(ValueError, match="already registered"):
            server.mount(_make_connector(["navigate"]), prefix="browser_tools")

    def test_mount_rejects_duplicate_prefix(self):
        server = MCPServer(name="test")
        server.mount(_make_connector(["click"]), prefix="browser")

        with pytest.raises(ValueError, match="already registered"):
            server.mount(_make_connector(["navigate"]), prefix="browser")


class TestMountedConnectorLifecycle:
    @pytest.mark.asyncio
    async def test_connect_mounted_connectors_builds_prefixed_tool_cache(self):
        server = MCPServer(name="test")
        browser = _make_connector(["click", "navigate"])
        filesystem = _make_connector(["read_file"])
        server.mount(browser, prefix="browser")
        server.mount(filesystem, prefix="fs")

        await server._connect_mounted_connectors()

        browser.connect.assert_called_once()
        browser.initialize.assert_called_once()
        filesystem.connect.assert_called_once()
        filesystem.initialize.assert_called_once()
        assert sorted(tool.name for tool in server._mounted_tools_cache) == [
            "browser_click",
            "browser_navigate",
            "fs_read_file",
        ]
        assert server._mounted_tool_map["browser_click"] == (browser, "click")
        assert server._mounted_tool_map["fs_read_file"] == (filesystem, "read_file")

    @pytest.mark.asyncio
    async def test_disconnect_mounted_connectors_disconnects_in_reverse_and_clears_cache(self):
        server = MCPServer(name="test")
        first = _make_connector(["click"])
        second = _make_connector(["navigate"])
        call_order: list[str] = []
        first.disconnect.side_effect = lambda: call_order.append("first")
        second.disconnect.side_effect = lambda: call_order.append("second")
        server.mount(first, prefix="browser")
        server.mount(second, prefix="fs")
        server._mounted_tools_cache = [_make_tool("browser_click")]
        server._mounted_tool_map = {"browser_click": (first, "click")}

        await server._disconnect_mounted_connectors()

        assert call_order == ["second", "first"]
        assert server._mounted_tools_cache == []
        assert server._mounted_tool_map == {}

    @pytest.mark.asyncio
    async def test_mount_invalidates_existing_mounted_tool_cache(self):
        server = MCPServer(name="test")
        browser = _make_connector(["click"])
        server.mount(browser, prefix="browser")

        await server._build_mounted_tool_cache()

        assert [tool.name for tool in server._mounted_tools_cache] == ["browser_click"]
        assert server._mounted_tool_map == {"browser_click": (browser, "click")}
        assert server._mounted_tool_cache_built is True

        server.mount(_make_connector(["read_file"]), prefix="fs")

        assert server._mounted_tools_cache == []
        assert server._mounted_tool_map == {}
        assert server._mounted_tool_cache_built is False


class TestMountedHandlerWrapping:
    @pytest.mark.asyncio
    async def test_wrap_handlers_lists_mounted_tools(self):
        server = MCPServer(name="test")
        connector = _make_connector(["click"])
        server.mount(connector, prefix="browser")
        await server._connect_mounted_connectors()

        native_result = ListToolsResult(tools=[_make_tool("local_tool")])

        async def native_list_tools(_request):
            return ServerResult(native_result)

        server._mcp_server.request_handlers[ListToolsRequest] = native_list_tools

        server._wrap_handlers_for_mounts()
        wrapped = server._mcp_server.request_handlers[ListToolsRequest]
        result = await wrapped(Mock())
        tools_result = _unwrap_server_result(result)

        assert [tool.name for tool in tools_result.tools] == ["local_tool", "browser_click"]

    @pytest.mark.asyncio
    async def test_wrap_handlers_rebuilds_mounted_tools_after_cache_invalidation(self):
        server = MCPServer(name="test")
        browser = _make_connector(["click"])
        server.mount(browser, prefix="browser")
        await server._build_mounted_tool_cache()
        browser.list_tools.reset_mock()

        filesystem = _make_connector(["read_file"])
        server.mount(filesystem, prefix="fs")

        native_result = ListToolsResult(tools=[_make_tool("local_tool")])

        async def native_list_tools(_request):
            return ServerResult(native_result)

        server._mcp_server.request_handlers[ListToolsRequest] = native_list_tools

        server._wrap_handlers_for_mounts()
        wrapped = server._mcp_server.request_handlers[ListToolsRequest]
        result = await wrapped(Mock())
        tools_result = _unwrap_server_result(result)

        assert [tool.name for tool in tools_result.tools] == [
            "local_tool",
            "browser_click",
            "fs_read_file",
        ]
        browser.list_tools.assert_awaited_once()
        filesystem.list_tools.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_wrap_handlers_routes_call_tool(self):
        server = MCPServer(name="test")
        mounted_result = _make_call_tool_result("mounted result")
        connector = _make_connector(["click"], tool_result=mounted_result)
        server.mount(connector, prefix="browser")
        await server._connect_mounted_connectors()

        native_handler = AsyncMock()
        server._mcp_server.request_handlers[CallToolRequest] = native_handler

        server._wrap_handlers_for_mounts()
        wrapped = server._mcp_server.request_handlers[CallToolRequest]
        request = SimpleNamespace(params=SimpleNamespace(name="browser_click", arguments={"selector": "#submit"}))

        result = await wrapped(request)

        connector.call_tool.assert_awaited_once_with("click", {"selector": "#submit"})
        native_handler.assert_not_called()
        call_result = _unwrap_server_result(result)
        assert call_result.content[0].text == "mounted result"

    @pytest.mark.asyncio
    async def test_wrap_handlers_routes_native_call_tool_when_name_is_not_mounted(self):
        server = MCPServer(name="test")
        native_result = _make_call_tool_result("native result")

        async def native_call_tool(_request):
            return ServerResult(native_result)

        server._mcp_server.request_handlers[CallToolRequest] = native_call_tool

        server._wrap_handlers_for_mounts()
        wrapped = server._mcp_server.request_handlers[CallToolRequest]
        request = SimpleNamespace(params=SimpleNamespace(name="local_tool", arguments={"value": 1}))

        result = await wrapped(request)

        call_result = _unwrap_server_result(result)
        assert call_result.content[0].text == "native result"


class TestMountedServerCallTool:
    @pytest.mark.asyncio
    async def test_call_tool_routes_to_mounted_connector(self):
        server = MCPServer(name="test")
        mounted_result = _make_call_tool_result("mounted result")
        connector = _make_connector(["click"], tool_result=mounted_result)
        server.mount(connector, prefix="browser")

        result = await server.call_tool("browser_click", {"selector": "#submit"})

        connector.list_tools.assert_awaited_once()
        connector.call_tool.assert_awaited_once_with("click", {"selector": "#submit"})
        assert result.content[0].text == "mounted result"

    @pytest.mark.asyncio
    async def test_call_tool_unknown_does_not_rebuild_initialized_cache(self):
        server = MCPServer(name="test")
        connector = _make_connector(["click"])
        server.mount(connector, prefix="browser")

        await server._build_mounted_tool_cache()
        connector.list_tools.reset_mock()

        with pytest.raises(ValueError, match="Unknown mounted tool"):
            await server.call_tool("browser_missing", {})

        connector.list_tools.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_call_tool_unknown_raises(self):
        server = MCPServer(name="test")

        with pytest.raises(ValueError, match="Unknown mounted tool"):
            await server.call_tool("browser_missing", {})

    @pytest.mark.asyncio
    async def test_ensure_mounted_tool_cache_builds_once_when_called_concurrently(self):
        server = MCPServer(name="test")
        server.mount(_make_connector(["click"]), prefix="browser")

        build_mock = AsyncMock()

        async def fake_build() -> None:
            await asyncio.sleep(0)
            server._mounted_tool_cache_built = True

        build_mock.side_effect = fake_build
        server._build_mounted_tool_cache = build_mock

        await asyncio.gather(
            server._ensure_mounted_tool_cache(),
            server._ensure_mounted_tool_cache(),
        )

        assert build_mock.await_count == 1
        assert server._mounted_tool_cache_built is True


class TestServerRunnerMountedLifecycle:
    @pytest.mark.asyncio
    async def test_run_with_mounted_connectors_wraps_serve_function(self):
        server = MCPServer(name="test")
        server._connect_mounted_connectors = AsyncMock()
        server._disconnect_mounted_connectors = AsyncMock()
        runner = ServerRunner(server)
        serve = AsyncMock()

        await runner._run_with_mounted_connectors(serve)

        server._connect_mounted_connectors.assert_awaited_once()
        serve.assert_awaited_once()
        server._disconnect_mounted_connectors.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_run_with_mounted_connectors_disconnects_after_startup_error(self):
        server = MCPServer(name="test")
        server._connect_mounted_connectors = AsyncMock(side_effect=RuntimeError("connect failed"))
        server._disconnect_mounted_connectors = AsyncMock()
        runner = ServerRunner(server)
        serve = AsyncMock()

        with pytest.raises(RuntimeError, match="connect failed"):
            await runner._run_with_mounted_connectors(serve)

        serve.assert_not_called()
        server._disconnect_mounted_connectors.assert_awaited_once()
