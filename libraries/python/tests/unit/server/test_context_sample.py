"""Tests for Context.sample() message normalization.

``Context.sample()`` accepts a plain string, a single ``SamplingMessage`` or a
sequence mixing both, but ``ServerSession.create_message()`` requires a
``list[SamplingMessage]``. These tests exercise every documented form
end-to-end through an in-memory client/server session and inspect the messages
the client actually receives.
"""

from mcp.shared.memory import create_connected_server_and_client_session
from mcp.types import CreateMessageResult, SamplingMessage, TextContent

from mcp_use.server import Context, MCPServer

REPLY_TEXT = "ok"


def _sampling_message(text: str) -> SamplingMessage:
    return SamplingMessage(role="user", content=TextContent(type="text", text=text))


def _make_server(call) -> MCPServer:
    server = MCPServer(name="sample-test")

    @server.tool()
    async def sample_tool(ctx: Context) -> str:
        response = await call(ctx)
        return response.content.text

    return server


async def _run(call):
    """Run ``call`` inside a tool and return (received messages, tool result)."""
    received: list[list[SamplingMessage]] = []

    async def sampling_callback(context, params):
        received.append(params.messages)
        return CreateMessageResult(
            role="assistant",
            content=TextContent(type="text", text=REPLY_TEXT),
            model="test-model",
        )

    server = _make_server(call)
    async with create_connected_server_and_client_session(server, sampling_callback=sampling_callback) as session:
        result = await session.call_tool("sample_tool", {})

    return received, result


async def test_string_form_sends_one_user_text_message():
    """A plain string becomes exactly one user SamplingMessage."""
    received, result = await _run(lambda ctx: ctx.sample("Analyze this"))

    assert not result.isError
    assert result.content[0].text == REPLY_TEXT
    assert len(received) == 1
    assert len(received[0]) == 1

    message = received[0][0]
    assert message.role == "user"
    assert isinstance(message.content, TextContent)
    assert message.content.text == "Analyze this"


async def test_single_sampling_message_is_preserved():
    """A single SamplingMessage is forwarded unchanged."""
    original = _sampling_message("single message")
    received, result = await _run(lambda ctx: ctx.sample(original))

    assert not result.isError
    assert received[0] == [original]


async def test_mixed_sequence_preserves_order():
    """Strings and SamplingMessages in a list keep their original order."""
    sampling_message = _sampling_message("second")
    received, result = await _run(lambda ctx: ctx.sample(["first", sampling_message, "third"]))

    assert not result.isError
    messages = received[0]
    assert [isinstance(message, SamplingMessage) for message in messages] == [True, True, True]
    assert [message.content.text for message in messages] == ["first", "second", "third"]
    assert [message.role for message in messages] == ["user", "user", "user"]


async def test_sequence_of_strings():
    """Any sequence (e.g. a tuple) of strings is normalized item by item."""
    received, result = await _run(lambda ctx: ctx.sample(("one", "two")))

    assert not result.isError
    assert [message.content.text for message in received[0]] == ["one", "two"]


async def test_empty_string_is_valid():
    """An empty string is a valid prompt and produces one empty text message."""
    received, result = await _run(lambda ctx: ctx.sample(""))

    assert not result.isError
    assert result.content[0].text == REPLY_TEXT
    assert len(received[0]) == 1
    assert received[0][0].content.text == ""
