"""
Tests for Context.elicit_url() — URL mode elicitation.

Verifies that the convenience method correctly delegates to
session.elicit_url() with proper defaults and parameter forwarding.
"""

from unittest.mock import AsyncMock, patch

import pytest
from mcp.types import ElicitResult

from mcp_use.server.context import Context


class FakeMCPServer:
    def __init__(self):
        self._client_log_level = "debug"


class FakeSession:
    def __init__(self):
        self.elicit_url = AsyncMock(return_value=ElicitResult(action="accept", content=None))


class FakeRequestContext:
    def __init__(self):
        self.session = FakeSession()
        self.request_id = "test-request-id"


def make_context() -> Context:
    server = FakeMCPServer()
    request_context = FakeRequestContext()
    return Context(request_context=request_context, fastmcp=server)


@pytest.mark.asyncio
async def test_elicit_url_delegates_to_session():
    """elicit_url should call session.elicit_url with the correct args."""
    ctx = make_context()

    result = await ctx.elicit_url("Please sign in", "https://auth.example.com/login")

    assert result.action == "accept"
    ctx.request_context.session.elicit_url.assert_awaited_once()
    call_kwargs = ctx.request_context.session.elicit_url.call_args.kwargs
    assert call_kwargs["message"] == "Please sign in"
    assert call_kwargs["url"] == "https://auth.example.com/login"
    assert call_kwargs["related_request_id"] == "test-request-id"
    # elicitation_id should be auto-generated (32 hex chars)
    assert len(call_kwargs["elicitation_id"]) == 32


@pytest.mark.asyncio
async def test_elicit_url_custom_elicitation_id():
    """A custom elicitation_id should be forwarded as-is."""
    ctx = make_context()

    await ctx.elicit_url("Sign in", "https://example.com", elicitation_id="my-custom-id")

    call_kwargs = ctx.request_context.session.elicit_url.call_args.kwargs
    assert call_kwargs["elicitation_id"] == "my-custom-id"


@pytest.mark.asyncio
async def test_elicit_url_decline():
    """Should propagate decline action from session."""
    ctx = make_context()
    ctx.request_context.session.elicit_url.return_value = ElicitResult(action="decline", content=None)

    result = await ctx.elicit_url("Sign in", "https://example.com")

    assert result.action == "decline"


@pytest.mark.asyncio
async def test_elicit_url_cancel():
    """Should propagate cancel action from session."""
    ctx = make_context()
    ctx.request_context.session.elicit_url.return_value = ElicitResult(action="cancel", content=None)

    result = await ctx.elicit_url("Sign in", "https://example.com")

    assert result.action == "cancel"


@pytest.mark.asyncio
async def test_elicit_url_tracks_telemetry():
    """Should call telemetry with context_type='elicit_url'."""
    ctx = make_context()

    with patch("mcp_use.server.context._telemetry") as mock_telemetry:
        await ctx.elicit_url("Sign in", "https://example.com")
        mock_telemetry.track_server_context.assert_called_once_with(context_type="elicit_url")


@pytest.mark.asyncio
async def test_elicit_url_auto_generates_unique_ids():
    """Each call should get a different auto-generated elicitation_id."""
    ctx = make_context()

    await ctx.elicit_url("Sign in", "https://example.com")
    id1 = ctx.request_context.session.elicit_url.call_args.kwargs["elicitation_id"]

    await ctx.elicit_url("Sign in again", "https://example.com")
    id2 = ctx.request_context.session.elicit_url.call_args.kwargs["elicitation_id"]

    assert id1 != id2
