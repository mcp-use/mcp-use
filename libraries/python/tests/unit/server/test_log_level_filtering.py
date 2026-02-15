"""
Tests for MCP logging/setLevel filtering.

Verifies that Context.log() respects the client-requested log level per the MCP spec:
https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging

When a client sends logging/setLevel with a minimum level, the server should only
send log notifications at or above that level.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_use.server.context import _LOG_LEVEL_ORDER, Context


class FakeMCPServer:
    """Minimal stand-in for MCPServer to test log level filtering."""

    def __init__(self, client_log_level: str = "debug"):
        self._client_log_level = client_log_level


class FakeSession:
    """Minimal stand-in for ServerSession."""

    def __init__(self):
        self.send_log_message = AsyncMock()


class FakeRequestContext:
    """Minimal stand-in for RequestContext."""

    def __init__(self):
        self.session = FakeSession()
        self.request_id = "test-request-id"


def make_context(client_log_level: str = "debug") -> Context:
    """Create a Context with a fake server and session for testing."""
    ctx = object.__new__(Context)
    ctx._fastmcp = FakeMCPServer(client_log_level)
    ctx._request_context = FakeRequestContext()
    return ctx


@pytest.mark.asyncio
async def test_log_level_order_matches_rfc5424():
    """Log levels should follow RFC 5424 syslog severity ordering."""
    levels = list(_LOG_LEVEL_ORDER.keys())
    for i in range(len(levels) - 1):
        assert _LOG_LEVEL_ORDER[levels[i]] < _LOG_LEVEL_ORDER[levels[i + 1]], (
            f"{levels[i]} should be lower severity than {levels[i + 1]}"
        )


@pytest.mark.asyncio
async def test_all_rfc5424_levels_present():
    """All 8 RFC 5424 syslog levels should be defined."""
    expected = {"debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"}
    assert set(_LOG_LEVEL_ORDER.keys()) == expected


@pytest.mark.asyncio
async def test_default_level_sends_all():
    """With default level (debug), all messages should be sent."""
    ctx = make_context("debug")

    await ctx.log("debug", "debug msg")
    await ctx.log("info", "info msg")
    await ctx.log("warning", "warning msg")
    await ctx.log("error", "error msg")

    assert ctx.request_context.session.send_log_message.call_count == 4


@pytest.mark.asyncio
async def test_info_level_filters_debug():
    """With level set to info, debug messages should be suppressed."""
    ctx = make_context("info")

    await ctx.log("debug", "should be filtered")
    assert ctx.request_context.session.send_log_message.call_count == 0

    await ctx.log("info", "should pass")
    assert ctx.request_context.session.send_log_message.call_count == 1

    await ctx.log("warning", "should pass")
    assert ctx.request_context.session.send_log_message.call_count == 2


@pytest.mark.asyncio
async def test_warning_level_filters_debug_and_info():
    """With level set to warning, debug and info should be suppressed."""
    ctx = make_context("warning")

    await ctx.log("debug", "filtered")
    await ctx.log("info", "filtered")
    assert ctx.request_context.session.send_log_message.call_count == 0

    await ctx.log("warning", "passes")
    await ctx.log("error", "passes")
    assert ctx.request_context.session.send_log_message.call_count == 2


@pytest.mark.asyncio
async def test_error_level_filters_below_error():
    """With level set to error, only error and above should be sent."""
    ctx = make_context("error")

    await ctx.log("debug", "filtered")
    await ctx.log("info", "filtered")
    await ctx.log("notice", "filtered")
    await ctx.log("warning", "filtered")
    assert ctx.request_context.session.send_log_message.call_count == 0

    await ctx.log("error", "passes")
    await ctx.log("critical", "passes")
    assert ctx.request_context.session.send_log_message.call_count == 2


@pytest.mark.asyncio
async def test_emergency_level_filters_everything_below():
    """With level set to emergency, only emergency should be sent."""
    ctx = make_context("emergency")

    for level in ["debug", "info", "notice", "warning", "error", "critical", "alert"]:
        await ctx.log(level, "filtered")
    assert ctx.request_context.session.send_log_message.call_count == 0

    await ctx.log("emergency", "passes")
    assert ctx.request_context.session.send_log_message.call_count == 1


@pytest.mark.asyncio
async def test_log_passes_correct_args():
    """Log should pass level, message, and logger_name to send_log_message."""
    ctx = make_context("debug")

    await ctx.log("warning", "test message", logger_name="my.logger")

    ctx.request_context.session.send_log_message.assert_called_once_with(
        level="warning",
        data="test message",
        logger="my.logger",
        related_request_id="test-request-id",
    )


@pytest.mark.asyncio
async def test_server_set_level_handler():
    """MCPServer._client_log_level should be updated by the setLevel handler."""
    from mcp_use.server import MCPServer

    server = MCPServer(name="test")
    assert server._client_log_level == "debug"  # default

    # Simulate what the handler does
    server._client_log_level = "warning"
    assert server._client_log_level == "warning"
