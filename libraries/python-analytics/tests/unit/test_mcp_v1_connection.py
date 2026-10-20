"""The mcp 1.x stream observer, driven with message-shaped objects (no mcp needed)."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import anyio
import pytest
from test_recorder import FakeChannel, FakeRequest

import mcp_use_analytics
from mcp_use_analytics._mcp_v1 import _Connection, _proxies
from mcp_use_analytics._recorder import Options, Recorder


def message(root: dict[str, Any], request: Any = None) -> SimpleNamespace:
    root_message = SimpleNamespace(root=SimpleNamespace(**root))
    return SimpleNamespace(message=root_message, metadata=SimpleNamespace(request_context=request))


def connection(stateless: bool = False) -> tuple[_Connection, FakeChannel]:
    channel = FakeChannel()
    recorder = Recorder(channel, Options(), framework="test", framework_version=None, server_info=None)  # type: ignore[arg-type]
    return _Connection(recorder, stateless), channel


def respond(conn: _Connection, item: Any, delivered: bool = True) -> None:
    """What the write proxy does: observe the response, write it, then report the write."""
    answered = conn.outbound(item)
    if answered is not None:
        conn.written(*answered, delivered)


INITIALIZE = {"method": "initialize", "id": 0, "params": {"protocolVersion": "2025-06-18", "clientInfo": {"name": "c"}}}
INITIALIZED = {"method": "notifications/initialized", "id": None, "params": None}
RESULT = {"id": 0, "method": None, "result": {"protocolVersion": "2025-06-18", "serverInfo": {"name": "s"}}}


def test_stateful_http_initialize_waits_for_the_session_id() -> None:
    conn, channel = connection()
    conn.inbound(message(INITIALIZE, FakeRequest({"host": "h"})))
    respond(conn, message(RESULT))
    assert channel.events == []  # the session id is only in the response headers
    conn.inbound(message(INITIALIZED, FakeRequest({"host": "h", "mcp-session-id": "abc"})))
    assert [(e.method, e.session_id) for e in channel.events] == [("initialize", "abc")]
    assert conn.protocol_version == "2025-06-18"


def test_flush_releases_a_held_initialize() -> None:
    conn, channel = connection()
    conn.inbound(message(INITIALIZE, FakeRequest({"host": "h"})))
    respond(conn, message(RESULT))
    assert mcp_use_analytics.flush(1)
    assert [(e.method, e.session_id) for e in channel.events] == [("initialize", None)]
    conn.release()
    assert len(channel.events) == 1


def test_stateless_http_and_stdio_send_right_away() -> None:
    conn, channel = connection(stateless=True)
    conn.inbound(message(INITIALIZE, FakeRequest({"host": "h"})))
    respond(conn, message(RESULT))
    assert [(e.method, e.stateless) for e in channel.events] == [("initialize", True)]

    conn, channel = connection()
    conn.inbound(message(INITIALIZE))
    respond(conn, message(RESULT))
    assert [(e.transport, bool(e.session_id), e.stateless) for e in channel.events] == [("stdio", True, None)]


def test_ignores_notifications_and_server_initiated_traffic() -> None:
    conn, channel = connection()
    conn.inbound(message(INITIALIZED))
    conn.inbound(message({"id": 5, "method": None, "result": {}}))  # the client's answer to a server request
    respond(conn, message({"id": 1, "method": "sampling/createMessage", "params": {}}))
    respond(conn, message({"id": None, "method": "notifications/progress", "params": {}}))
    conn.inbound(RuntimeError("transport error"))  # type: ignore[arg-type]
    assert channel.events == [] and conn.pending == {}


def test_jsonrpc_error_response() -> None:
    conn, channel = connection()
    conn.inbound(message({"method": "tools/call", "id": "r1", "params": {"name": "t"}}))
    error = SimpleNamespace(code=-32602, message="bad", data=None)
    respond(conn, message({"id": "r1", "method": None, "error": error}))
    (event,) = channel.events
    assert (event.outcome, event.error_code, event.error_message, event.target) == ("error", -32602, "bad", "t")


def test_sse_session_from_the_query_string() -> None:
    conn, channel = connection()
    request = FakeRequest({"host": "h"}, path="/messages/")
    request.query_params["session_id"] = "sse-1"
    conn.inbound(message({"method": "ping", "id": 1, "params": None}, request))
    respond(conn, message({"id": 1, "method": None, "result": {}}))
    assert [(e.transport, e.session_id, e.stateless) for e in channel.events] == [("sse", "sse-1", None)]


CALL = {"method": "tools/call", "id": 3, "params": {"name": "slow"}}
CALL_RESULT = {"id": 3, "method": None, "result": {"content": [{"type": "text", "text": "done"}]}}


def wire(conn: _Connection, event: Any) -> dict[str, Any]:
    _, body = conn.recorder.encode(event, conn.recorder.channel.config)
    return json.loads(body)


def test_a_response_written_after_the_client_went_away_is_still_recorded() -> None:
    # Stateless HTTP closes the read side when the client disconnects (or times
    # out); fastmcp still finishes the tool and writes its response.
    conn, channel = connection(stateless=True)
    conn.inbound(message(CALL, FakeRequest({"host": "h"})))
    conn.close()
    respond(conn, message(CALL_RESULT))
    assert [(e.target, e.outcome) for e in channel.events] == [("slow", "success")]


def test_requests_unanswered_when_run_returns_have_no_outcome() -> None:
    conn, channel = connection()
    conn.inbound(message(INITIALIZE))  # stdio
    respond(conn, message(RESULT))
    conn.inbound(message(CALL))
    conn.close()  # stdin EOF: the request is still in flight
    assert [e.method for e in channel.events] == ["initialize"]
    conn.finish()  # run() returned without answering it
    event = channel.events[-1]
    assert (event.target, event.outcome, event.response) == ("slow", None, None)
    assert event.duration_ms is not None and event.duration_ms >= 0
    out = wire(conn, event)
    assert {"outcome", "error", "response_size"}.isdisjoint(out), out
    assert out["method"] == "tools/call" and out["transport"] == "stdio" and out["request_size"] > 0
    conn.finish()
    assert len(channel.events) == 2  # recorded once


def test_a_response_that_could_not_be_written_has_no_outcome() -> None:
    conn, channel = connection(stateless=True)
    conn.inbound(message(CALL, FakeRequest({"host": "h"})))
    error = SimpleNamespace(code=-32603, message="boom", data=None)
    respond(conn, message({"id": 3, "method": None, "error": error}), delivered=False)
    (event,) = channel.events
    assert (event.outcome, event.error_code, event.error_message, event.response) == (None, None, None, None)
    conn.finish()
    assert len(channel.events) == 1


def test_a_held_initialize_whose_write_failed_is_sent_without_an_outcome() -> None:
    conn, channel = connection()
    conn.inbound(message(INITIALIZE, FakeRequest({"host": "h"})))
    respond(conn, message(RESULT), delivered=False)
    assert [(e.method, e.outcome) for e in channel.events] == [("initialize", None)]
    assert conn.deferred == []
    assert mcp_use_analytics.flush(1)
    assert len(channel.events) == 1


async def test_write_proxy_reports_a_failed_write() -> None:
    _, write_proxy = _proxies()
    conn, channel = connection(stateless=True)
    conn.inbound(message(CALL, FakeRequest({"host": "h"})))
    send, receive = anyio.create_memory_object_stream(1)
    await receive.aclose()  # the transport is gone
    with pytest.raises(anyio.BrokenResourceError):
        await write_proxy(send, conn).send(message(CALL_RESULT))
    assert [(e.target, e.outcome) for e in channel.events] == [("slow", None)]


async def test_run_records_requests_left_unanswered() -> None:
    from mcp_use_analytics import _mcp_v1

    class Server:
        """A low-level server whose run() is cancelled mid-request (client gone)."""

        request_handlers: dict[Any, Any] = {}

        async def run(self, read_stream: Any, write_stream: Any, options: Any) -> None:
            await read_stream.receive()  # the request; never answered

    channel = FakeChannel()
    recorder = Recorder(channel, Options(), framework="test", framework_version=None, server_info=None)  # type: ignore[arg-type]
    server = Server()
    assert _mcp_v1.install(server, recorder)
    send, receive = anyio.create_memory_object_stream(1)
    out_send, _out_receive = anyio.create_memory_object_stream(1)
    await send.send(message(CALL))
    await server.run(receive, out_send, None)
    assert [(e.method, e.target, e.outcome) for e in channel.events] == [("tools/call", "slow", None)]


def test_a_request_the_client_cancelled_has_no_outcome() -> None:
    conn, channel = connection()
    conn.inbound(message(CALL, FakeRequest({"host": "h", "mcp-session-id": "s1"})))
    cancel = {"method": "notifications/cancelled", "id": None, "params": {"requestId": 3, "reason": "timeout"}}
    conn.inbound(message(cancel, FakeRequest({"host": "h", "mcp-session-id": "s1"})))
    error = SimpleNamespace(code=0, message="Request cancelled", data=None)  # what mcp 1.x answers
    respond(conn, message({"id": 3, "method": None, "error": error}))
    assert [(e.target, e.outcome, e.error_code) for e in channel.events] == [("slow", None, None)]
    assert conn.cancelled == set()
    conn.inbound(message(cancel))  # a late or unknown cancellation changes nothing
    assert conn.cancelled == set() and len(channel.events) == 1
