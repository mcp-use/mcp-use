"""
Unit tests for ToolAuthorizationMiddleware.
"""

import pytest
from mcp.types import CallToolRequestParams, CallToolResult, TextContent

from mcp_use.client.middleware.authorization import ToolAuthorizationMiddleware
from mcp_use.client.middleware.middleware import MiddlewareContext


def _make_context(tool_name: str, arguments: dict | None = None) -> MiddlewareContext:
    params = CallToolRequestParams(name=tool_name, arguments=arguments or {})
    return MiddlewareContext(
        id="test-id",
        method="tools/call",
        params=params,
        connection_id="conn-1",
        timestamp=0.0,
    )


async def _allow_next(context: MiddlewareContext) -> CallToolResult:
    """Simulates the next middleware/handler — always succeeds."""
    return CallToolResult(
        content=[TextContent(type="text", text="ok")],
        isError=False,
    )


def _is_denied(result: CallToolResult) -> bool:
    return result.isError is True


class TestDenylist:
    @pytest.mark.asyncio
    async def test_denied_tool_is_blocked(self):
        mw = ToolAuthorizationMiddleware(denied_tools=["delete_note"])
        ctx = _make_context("delete_note")
        result = await mw.on_call_tool(ctx, _allow_next)
        assert _is_denied(result)
        assert "delete_note" in result.content[0].text

    @pytest.mark.asyncio
    async def test_non_denied_tool_passes(self):
        mw = ToolAuthorizationMiddleware(denied_tools=["delete_note"])
        ctx = _make_context("search_docs")
        result = await mw.on_call_tool(ctx, _allow_next)
        assert not _is_denied(result)

    @pytest.mark.asyncio
    async def test_empty_denylist_blocks_nothing(self):
        mw = ToolAuthorizationMiddleware(denied_tools=[])
        ctx = _make_context("deploy_prod")
        result = await mw.on_call_tool(ctx, _allow_next)
        assert not _is_denied(result)


class TestAllowlist:
    @pytest.mark.asyncio
    async def test_allowed_tool_passes(self):
        mw = ToolAuthorizationMiddleware(allowed_tools=["search_docs"])
        ctx = _make_context("search_docs")
        result = await mw.on_call_tool(ctx, _allow_next)
        assert not _is_denied(result)

    @pytest.mark.asyncio
    async def test_unlisted_tool_is_blocked(self):
        mw = ToolAuthorizationMiddleware(allowed_tools=["search_docs"])
        ctx = _make_context("save_note")
        result = await mw.on_call_tool(ctx, _allow_next)
        assert _is_denied(result)
        assert "save_note" in result.content[0].text

    @pytest.mark.asyncio
    async def test_no_allowlist_allows_all(self):
        mw = ToolAuthorizationMiddleware()
        ctx = _make_context("any_tool")
        result = await mw.on_call_tool(ctx, _allow_next)
        assert not _is_denied(result)


class TestDenylistOverridesAllowlist:
    @pytest.mark.asyncio
    async def test_denylist_takes_precedence_over_allowlist(self):
        # tool is in both lists — denylist wins
        mw = ToolAuthorizationMiddleware(
            allowed_tools=["search_docs", "delete_note"],
            denied_tools=["delete_note"],
        )
        ctx = _make_context("delete_note")
        result = await mw.on_call_tool(ctx, _allow_next)
        assert _is_denied(result)

    @pytest.mark.asyncio
    async def test_allowed_and_not_denied_passes(self):
        mw = ToolAuthorizationMiddleware(
            allowed_tools=["search_docs"],
            denied_tools=["delete_note"],
        )
        ctx = _make_context("search_docs")
        result = await mw.on_call_tool(ctx, _allow_next)
        assert not _is_denied(result)


class TestCustomAuthorizer:
    @pytest.mark.asyncio
    async def test_authorizer_returning_true_allows(self):
        async def always_allow(tool_name: str, arguments: dict) -> bool:
            return True

        mw = ToolAuthorizationMiddleware(authorizer=always_allow)
        result = await mw.on_call_tool(_make_context("deploy_prod"), _allow_next)
        assert not _is_denied(result)

    @pytest.mark.asyncio
    async def test_authorizer_returning_false_denies(self):
        async def always_deny(tool_name: str, arguments: dict) -> bool:
            return False

        mw = ToolAuthorizationMiddleware(authorizer=always_deny)
        result = await mw.on_call_tool(_make_context("search_docs"), _allow_next)
        assert _is_denied(result)

    @pytest.mark.asyncio
    async def test_authorizer_receives_tool_name_and_arguments(self):
        received = {}

        async def capture(tool_name: str, arguments: dict) -> bool:
            received["tool_name"] = tool_name
            received["arguments"] = arguments
            return True

        mw = ToolAuthorizationMiddleware(authorizer=capture)
        await mw.on_call_tool(_make_context("search_docs", {"query": "hello"}), _allow_next)
        assert received["tool_name"] == "search_docs"
        assert received["arguments"] == {"query": "hello"}

    @pytest.mark.asyncio
    async def test_authorizer_not_called_when_denylist_blocks(self):
        called = []

        async def track(tool_name: str, arguments: dict) -> bool:
            called.append(tool_name)
            return True

        mw = ToolAuthorizationMiddleware(denied_tools=["delete_note"], authorizer=track)
        await mw.on_call_tool(_make_context("delete_note"), _allow_next)
        assert called == [], "Authorizer should not be called when denylist blocks first"

    @pytest.mark.asyncio
    async def test_authorizer_not_called_when_allowlist_blocks(self):
        called = []

        async def track(tool_name: str, arguments: dict) -> bool:
            called.append(tool_name)
            return True

        mw = ToolAuthorizationMiddleware(allowed_tools=["search_docs"], authorizer=track)
        await mw.on_call_tool(_make_context("save_note"), _allow_next)
        assert called == [], "Authorizer should not be called when allowlist blocks first"


class TestNoneArguments:
    @pytest.mark.asyncio
    async def test_none_arguments_treated_as_empty_dict(self):
        received = {}

        async def capture(tool_name: str, arguments: dict) -> bool:
            received["arguments"] = arguments
            return True

        # Simulate context where arguments is None
        params = CallToolRequestParams(name="search_docs", arguments=None)
        ctx = MiddlewareContext(
            id="test-id",
            method="tools/call",
            params=params,
            connection_id="conn-1",
            timestamp=0.0,
        )
        mw = ToolAuthorizationMiddleware(authorizer=capture)
        await mw.on_call_tool(ctx, _allow_next)
        assert received["arguments"] == {}
