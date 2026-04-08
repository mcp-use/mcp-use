"""
Unit tests for ToolAuthorizationMiddleware.
"""

import pytest
from mcp.types import CallToolRequestParams, CallToolResult, ListToolsResult, TextContent, Tool

from mcp_use.client.middleware.authorization import ToolAuthorizationMiddleware
from mcp_use.client.middleware.middleware import MiddlewareContext


def _make_call_context(tool_name: str, arguments: dict | None = None) -> MiddlewareContext:
    params = CallToolRequestParams(name=tool_name, arguments=arguments or {})
    return MiddlewareContext(
        id="test-id",
        method="tools/call",
        params=params,
        connection_id="conn-1",
        timestamp=0.0,
    )


def _make_list_context() -> MiddlewareContext:
    return MiddlewareContext(
        id="test-id",
        method="tools/list",
        params=None,
        connection_id="conn-1",
        timestamp=0.0,
    )


def _tool(name: str) -> Tool:
    return Tool(name=name, description=f"Tool {name}", inputSchema={"type": "object", "properties": {}})


async def _allow_next(context: MiddlewareContext) -> CallToolResult:
    """Simulates the next handler — always succeeds."""
    return CallToolResult(content=[TextContent(type="text", text="ok")], isError=False)


def _make_list_next(*tool_names: str):
    """Returns a next-handler that produces a ListToolsResult with given tools."""

    async def _next(context: MiddlewareContext) -> ListToolsResult:
        return ListToolsResult(tools=[_tool(n) for n in tool_names])

    return _next


def _is_denied(result: CallToolResult) -> bool:
    return result.isError is True


# ---------------------------------------------------------------------------
# Denylist
# ---------------------------------------------------------------------------
class TestDenylist:
    @pytest.mark.asyncio
    async def test_denied_tool_is_blocked(self):
        mw = ToolAuthorizationMiddleware(denied_tools=["delete_note"])
        result = await mw.on_call_tool(_make_call_context("delete_note"), _allow_next)
        assert _is_denied(result)
        assert "delete_note" in result.content[0].text

    @pytest.mark.asyncio
    async def test_non_denied_tool_passes(self):
        mw = ToolAuthorizationMiddleware(denied_tools=["delete_note"])
        result = await mw.on_call_tool(_make_call_context("search_docs"), _allow_next)
        assert not _is_denied(result)

    @pytest.mark.asyncio
    async def test_empty_denylist_blocks_nothing(self):
        mw = ToolAuthorizationMiddleware(denied_tools=[])
        result = await mw.on_call_tool(_make_call_context("deploy_prod"), _allow_next)
        assert not _is_denied(result)


# ---------------------------------------------------------------------------
# Allowlist
# ---------------------------------------------------------------------------
class TestAllowlist:
    @pytest.mark.asyncio
    async def test_allowed_tool_passes(self):
        mw = ToolAuthorizationMiddleware(allowed_tools=["search_docs"])
        result = await mw.on_call_tool(_make_call_context("search_docs"), _allow_next)
        assert not _is_denied(result)

    @pytest.mark.asyncio
    async def test_unlisted_tool_is_blocked(self):
        mw = ToolAuthorizationMiddleware(allowed_tools=["search_docs"])
        result = await mw.on_call_tool(_make_call_context("save_note"), _allow_next)
        assert _is_denied(result)
        assert "save_note" in result.content[0].text

    @pytest.mark.asyncio
    async def test_no_allowlist_allows_all(self):
        mw = ToolAuthorizationMiddleware()
        result = await mw.on_call_tool(_make_call_context("any_tool"), _allow_next)
        assert not _is_denied(result)


# ---------------------------------------------------------------------------
# Denylist takes precedence over allowlist
# ---------------------------------------------------------------------------
class TestDenylistOverridesAllowlist:
    @pytest.mark.asyncio
    async def test_denylist_takes_precedence_over_allowlist(self):
        mw = ToolAuthorizationMiddleware(
            allowed_tools=["search_docs", "delete_note"],
            denied_tools=["delete_note"],
        )
        result = await mw.on_call_tool(_make_call_context("delete_note"), _allow_next)
        assert _is_denied(result)

    @pytest.mark.asyncio
    async def test_allowed_and_not_denied_passes(self):
        mw = ToolAuthorizationMiddleware(
            allowed_tools=["search_docs"],
            denied_tools=["delete_note"],
        )
        result = await mw.on_call_tool(_make_call_context("search_docs"), _allow_next)
        assert not _is_denied(result)


# ---------------------------------------------------------------------------
# Custom authorizer
# ---------------------------------------------------------------------------
class TestCustomAuthorizer:
    @pytest.mark.asyncio
    async def test_authorizer_returning_true_allows(self):
        async def always_allow(tool_name, arguments, agent_context) -> bool:
            return True

        mw = ToolAuthorizationMiddleware(authorizer=always_allow)
        result = await mw.on_call_tool(_make_call_context("deploy_prod"), _allow_next)
        assert not _is_denied(result)

    @pytest.mark.asyncio
    async def test_authorizer_returning_false_denies(self):
        async def always_deny(tool_name, arguments, agent_context) -> bool:
            return False

        mw = ToolAuthorizationMiddleware(authorizer=always_deny)
        result = await mw.on_call_tool(_make_call_context("search_docs"), _allow_next)
        assert _is_denied(result)

    @pytest.mark.asyncio
    async def test_authorizer_receives_tool_name_and_arguments(self):
        received = {}

        async def capture(tool_name, arguments, agent_context) -> bool:
            received["tool_name"] = tool_name
            received["arguments"] = arguments
            return True

        mw = ToolAuthorizationMiddleware(authorizer=capture)
        await mw.on_call_tool(_make_call_context("search_docs", {"query": "hello"}), _allow_next)
        assert received["tool_name"] == "search_docs"
        assert received["arguments"] == {"query": "hello"}

    @pytest.mark.asyncio
    async def test_authorizer_not_called_when_denylist_blocks(self):
        called = []

        async def track(tool_name, arguments, agent_context) -> bool:
            called.append(tool_name)
            return True

        mw = ToolAuthorizationMiddleware(denied_tools=["delete_note"], authorizer=track)
        await mw.on_call_tool(_make_call_context("delete_note"), _allow_next)
        assert called == [], "Authorizer should not be called when denylist blocks first"

    @pytest.mark.asyncio
    async def test_authorizer_not_called_when_allowlist_blocks(self):
        called = []

        async def track(tool_name, arguments, agent_context) -> bool:
            called.append(tool_name)
            return True

        mw = ToolAuthorizationMiddleware(allowed_tools=["search_docs"], authorizer=track)
        await mw.on_call_tool(_make_call_context("save_note"), _allow_next)
        assert called == [], "Authorizer should not be called when allowlist blocks first"


# ---------------------------------------------------------------------------
# Agent context forwarded to authorizer
# ---------------------------------------------------------------------------
class TestAgentContext:
    @pytest.mark.asyncio
    async def test_agent_context_forwarded_to_authorizer(self):
        received = {}

        async def capture(tool_name, arguments, agent_context) -> bool:
            received["agent_context"] = agent_context
            return True

        mw = ToolAuthorizationMiddleware(
            agent_context={"agent_id": "research-1", "token": "secret"},
            authorizer=capture,
        )
        await mw.on_call_tool(_make_call_context("search_docs"), _allow_next)
        assert received["agent_context"] == {"agent_id": "research-1", "token": "secret"}

    @pytest.mark.asyncio
    async def test_missing_agent_context_defaults_to_empty_dict(self):
        received = {}

        async def capture(tool_name, arguments, agent_context) -> bool:
            received["agent_context"] = agent_context
            return True

        mw = ToolAuthorizationMiddleware(authorizer=capture)
        await mw.on_call_tool(_make_call_context("search_docs"), _allow_next)
        assert received["agent_context"] == {}

    @pytest.mark.asyncio
    async def test_agent_context_can_drive_deny_decision(self):
        async def role_check(tool_name, arguments, agent_context) -> bool:
            return "admin" in agent_context.get("roles", [])

        mw_admin = ToolAuthorizationMiddleware(agent_context={"roles": ["admin"]}, authorizer=role_check)
        mw_reader = ToolAuthorizationMiddleware(agent_context={"roles": ["reader"]}, authorizer=role_check)
        assert not _is_denied(await mw_admin.on_call_tool(_make_call_context("deploy_prod"), _allow_next))
        assert _is_denied(await mw_reader.on_call_tool(_make_call_context("deploy_prod"), _allow_next))


# ---------------------------------------------------------------------------
# on_list_tools filtering
# ---------------------------------------------------------------------------
class TestListToolsFiltering:
    @pytest.mark.asyncio
    async def test_denylist_removes_tools_from_list(self):
        mw = ToolAuthorizationMiddleware(denied_tools=["delete_note", "deploy_prod"])
        result = await mw.on_list_tools(
            _make_list_context(),
            _make_list_next("search_docs", "delete_note", "deploy_prod"),
        )
        names = [t.name for t in result.tools]
        assert names == ["search_docs"]

    @pytest.mark.asyncio
    async def test_allowlist_removes_unlisted_tools_from_list(self):
        mw = ToolAuthorizationMiddleware(allowed_tools=["search_docs", "save_note"])
        result = await mw.on_list_tools(
            _make_list_context(),
            _make_list_next("search_docs", "save_note", "delete_note", "deploy_prod"),
        )
        names = [t.name for t in result.tools]
        assert names == ["search_docs", "save_note"]

    @pytest.mark.asyncio
    async def test_no_rules_returns_all_tools(self):
        mw = ToolAuthorizationMiddleware()
        result = await mw.on_list_tools(
            _make_list_context(),
            _make_list_next("search_docs", "save_note", "delete_note"),
        )
        assert len(result.tools) == 3

    @pytest.mark.asyncio
    async def test_empty_tool_list_returned_as_is(self):
        mw = ToolAuthorizationMiddleware(denied_tools=["delete_note"])
        result = await mw.on_list_tools(_make_list_context(), _make_list_next())
        assert result.tools == []


# ---------------------------------------------------------------------------
# Fail-safe behavior
# ---------------------------------------------------------------------------
class TestFailSafe:
    @pytest.mark.asyncio
    async def test_authorizer_exception_denies_call(self):
        async def boom(tool_name, arguments, agent_context) -> bool:
            raise RuntimeError("permission engine unreachable")

        mw = ToolAuthorizationMiddleware(authorizer=boom)
        result = await mw.on_call_tool(_make_call_context("search_docs"), _allow_next)
        assert _is_denied(result), "Authorizer exception must fail-safe to deny"
        assert "search_docs" in result.content[0].text

    @pytest.mark.asyncio
    async def test_next_handler_not_called_when_authorizer_raises(self):
        called = []

        async def boom(tool_name, arguments, agent_context) -> bool:
            raise RuntimeError("boom")

        async def tracking_next(context) -> CallToolResult:
            called.append(context.params.name)
            return CallToolResult(content=[TextContent(type="text", text="ok")], isError=False)

        mw = ToolAuthorizationMiddleware(authorizer=boom)
        await mw.on_call_tool(_make_call_context("search_docs"), tracking_next)
        assert called == [], "call_next must not execute when authorizer fails"


# ---------------------------------------------------------------------------
# Empty allowlist edge case
# ---------------------------------------------------------------------------
class TestEmptyAllowlist:
    @pytest.mark.asyncio
    async def test_empty_allowlist_denies_everything(self):
        mw = ToolAuthorizationMiddleware(allowed_tools=[])
        result = await mw.on_call_tool(_make_call_context("search_docs"), _allow_next)
        assert _is_denied(result)

    @pytest.mark.asyncio
    async def test_empty_allowlist_filters_all_tools_from_list(self):
        mw = ToolAuthorizationMiddleware(allowed_tools=[])
        result = await mw.on_list_tools(_make_list_context(), _make_list_next("search_docs", "save_note"))
        assert result.tools == []


# ---------------------------------------------------------------------------
# Pagination and metadata are preserved through list_tools filtering
# ---------------------------------------------------------------------------
class TestListToolsPreservesPagination:
    @pytest.mark.asyncio
    async def test_next_cursor_preserved_through_filtering(self):
        async def _next_with_cursor(context: MiddlewareContext) -> ListToolsResult:
            return ListToolsResult(
                tools=[_tool("search_docs"), _tool("delete_note")],
                nextCursor="next-page-token",
            )

        mw = ToolAuthorizationMiddleware(denied_tools=["delete_note"])
        result = await mw.on_list_tools(_make_list_context(), _next_with_cursor)
        assert [t.name for t in result.tools] == ["search_docs"]
        assert result.nextCursor == "next-page-token"


# ---------------------------------------------------------------------------
# Authorizer is NOT consulted during list_tools (documented behavior)
# ---------------------------------------------------------------------------
class TestListToolsSkipsAuthorizer:
    @pytest.mark.asyncio
    async def test_authorizer_not_called_during_list_tools(self):
        called = []

        async def track(tool_name, arguments, agent_context) -> bool:
            called.append(tool_name)
            return False  # would deny if asked

        mw = ToolAuthorizationMiddleware(authorizer=track)
        result = await mw.on_list_tools(_make_list_context(), _make_list_next("search_docs", "save_note"))
        assert called == []
        # All tools remain because only static rules apply during list_tools
        assert {t.name for t in result.tools} == {"search_docs", "save_note"}


# ---------------------------------------------------------------------------
# None arguments edge case
# ---------------------------------------------------------------------------
class TestNoneArguments:
    @pytest.mark.asyncio
    async def test_none_arguments_treated_as_empty_dict(self):
        received = {}

        async def capture(tool_name, arguments, agent_context) -> bool:
            received["arguments"] = arguments
            return True

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
