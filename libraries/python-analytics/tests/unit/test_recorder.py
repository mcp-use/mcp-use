from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any

import pytest
from mock_ingest import API_KEY, FakeClock, MockIngest

from mcp_use_analytics import PayloadContext, RequestInfo
from mcp_use_analytics._recorder import Event, Options, Recorder, uuid7
from mcp_use_analytics._transport import CONFIG_MAX_AGE, Channel, RemoteConfig

# {"iss": "https://issuer.example", "sub": "user_123", "name": "Ada", "email": "ada@example.com"}
JWT = (
    "eyJhbGciOiJub25lIn0."
    "eyJpc3MiOiJodHRwczovL2lzc3Vlci5leGFtcGxlIiwic3ViIjoidXNlcl8xMjMiLCJuYW1lIjoiQWRhIiwiZW1haWwiOiJhZGFAZXhhbXBsZS5jb20ifQ"
    ".sig"
)
TOKEN_HASH = hashlib.sha256(b"https://issuer.example\x00user_123").hexdigest()
CAPTURE = RemoteConfig(capture_payloads=True, identify_actors=True, known=True)
NO_CAPTURE = RemoteConfig(known=True)


class FakeChannel:
    def __init__(self, config: RemoteConfig = NO_CAPTURE) -> None:
        self.config = config
        self.events: list[Event] = []

    def enqueue(self, event: Event, *, urgent: bool = False) -> None:
        self.events.append(event)


class FakeHeaders(dict):
    def get(self, key: str, default: Any = None) -> Any:  # case-insensitive like Starlette
        return super().get(key.lower(), default)


class FakeRequest:
    def __init__(self, headers: dict[str, str], path: str = "/mcp") -> None:
        self.method = "POST"
        self.headers = FakeHeaders({k.lower(): v for k, v in headers.items()})
        self.url = type("URL", (), {"path": path})()
        self.query_params = FakeHeaders()


def recorder(config: RemoteConfig = NO_CAPTURE, **options: Any) -> Recorder:
    return Recorder(
        FakeChannel(config),  # type: ignore[arg-type]
        Options(**options),
        framework="test",
        framework_version="1.0",
        server_info={"name": "srv", "version": "2"},
    )


def encode(rec: Recorder, config: RemoteConfig | None = None) -> dict[str, Any]:
    event = rec.channel.events[-1]  # type: ignore[attr-defined]
    envelope, body = rec.encode(event, config or rec.channel.config)
    batch = json.loads(envelope + b"[" + body + b"]}")
    assert batch["schema"] == "manufact.sdk.v1"
    assert batch["sdk"] == {
        "name": "mcp-use-analytics",
        "version": batch["sdk"]["version"],
        "language": "python",
        "framework": "test",
        "framework_version": "1.0",
        "runtime": batch["sdk"]["runtime"],
    }
    return batch["events"][0]


def call(rec: Recorder, name: str = "search", arguments: dict[str, Any] | None = None, **begin: Any) -> Event | None:
    params = {"name": name, "arguments": arguments or {"query": "q"}}
    return rec.begin("tools/call", 7, params, **begin)


def test_success_event_fields() -> None:
    rec = recorder()
    request = FakeRequest(
        {
            "Host": "app.example.com",
            "User-Agent": "claude-ai/1.0",
            "Origin": "https://claude.ai",
            "Referer": "https://claude.ai/chat",
            "CF-IPCountry": "br",
            "Content-Length": "64",
            "Authorization": f"Bearer {JWT}",
            "traceparent": "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
            "MCP-Protocol-Version": "2025-06-18",
        }
    )
    event = call(
        rec,
        http_request=request,
        session_id="sess-1",
        transport="streamable-http",
        stateless=False,
        client=("claude-ai", "0.1"),
    )
    rec.complete(event, result={"content": [{"type": "text", "text": "ok"}], "isError": False})
    out = encode(rec)
    assert re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", out["id"])
    assert out["time"].endswith("Z") and out["duration_ms"] >= 0
    assert out["method"] == "tools/call" and out["request_id"] == 7 and out["target"] == "search"
    assert out["outcome"] == "success" and "error" not in out
    assert out["session_id"] == "sess-1" and out["transport"] == "streamable-http" and out["stateless"] is False
    assert out["client"] == {"name": "claude-ai", "version": "0.1"}
    assert out["protocol_version"] == "2025-06-18"
    assert out["http"] == {
        "method": "POST",
        "path": "/mcp",
        "host": "app.example.com",
        "user_agent": "claude-ai/1.0",
        "origin": "https://claude.ai",
        "referer": "https://claude.ai/chat",
        "country": "BR",
    }
    assert out["actor"] == {"token_hash": TOKEN_HASH}  # name/email only with identify_actors
    assert out["trace_id"] == "0af7651916cd43dd8448eb211c80319c"
    assert out["request_size"] == 64 and out["response_size"] > 0
    assert "request_payload" not in out and "client_info" not in out


def test_tool_error_and_jsonrpc_error() -> None:
    rec = recorder()
    rec.complete(
        call(rec),
        result={
            "content": [{"type": "text", "text": "line 1"}, {"type": "image"}, {"type": "text", "text": "line 2"}],
            "isError": True,
        },
    )
    assert encode(rec)["error"] == {"message": "line 1\nline 2"}
    assert encode(rec)["outcome"] == "tool_error"
    rec.complete(call(rec), failed=True, error_code=-32602, error_message="Unknown tool: x" + "!" * 600)
    out = encode(rec)
    assert out["outcome"] == "error" and out["error"]["code"] == -32602 and len(out["error"]["message"]) == 500


def test_gateway_forwarded_requests_are_skipped() -> None:
    rec = recorder()
    assert call(rec, http_request=FakeRequest({"X-Gateway-Request-Id": "req_1"})) is None


def test_initialize_records_client_info_and_server_info() -> None:
    rec = recorder()
    params = {"protocolVersion": "2025-06-18", "clientInfo": {"name": "cursor", "version": "1.2", "title": "Cursor"}}
    event = rec.begin("initialize", 0, params)
    rec.complete(event, result={"protocolVersion": "2025-06-18", "serverInfo": {"name": "teller", "version": "1.4.0"}})
    out = encode(rec)
    assert out["client"] == {"name": "cursor", "version": "1.2"}
    assert out["client_info"] == {"name": "cursor", "version": "1.2", "title": "Cursor"}
    assert out["protocol_version"] == "2025-06-18"
    assert rec.server_info == {"name": "teller", "version": "1.4.0"}
    envelope, _ = rec.encode(event, NO_CAPTURE)
    assert json.loads(envelope + b"[]}")["server"] == {"name": "teller", "version": "1.4.0"}


def test_modern_client_identity_and_openai_meta() -> None:
    rec = recorder()
    meta = {
        "io.modelcontextprotocol/clientInfo": {"name": "chatgpt", "version": "5"},
        "openai/session": "conv-1",
        "openai/subject": "sub-1",
        "openai/organization": "org-1",
        "openai/userLocation": {"country": "us"},
        "traceparent": "00-ABCDEF0123456789abcdef0123456789-0123456789abcdef-01",
    }
    rec.complete(rec.begin("tools/call", "a1", {"name": "t", "_meta": meta}), result={"content": []})
    out = encode(rec)
    assert out["client"] == {"name": "chatgpt", "version": "5"}
    assert out["openai"] == {"session": "conv-1", "subject": "sub-1", "organization": "org-1", "country": "US"}
    assert out["trace_id"] == "abcdef0123456789abcdef0123456789"
    assert out["request_id"] == "a1"


def test_payloads_need_dashboard_and_local_consent() -> None:
    for config, local, expected in [
        (CAPTURE, None, True),
        (CAPTURE, True, True),
        (CAPTURE, False, False),
        (NO_CAPTURE, None, False),
        (NO_CAPTURE, True, False),
    ]:
        rec = recorder(config, capture_payloads=local)
        rec.complete(
            call(rec, arguments={"api_key": "k", "query": "q"}), result={"content": [{"type": "text", "text": "r"}]}
        )
        out = encode(rec)
        assert ("request_payload" in out) is expected, (config, local)
        if expected:
            assert out["request_payload"] == {
                "jsonrpc": "2.0",
                "id": 7,
                "method": "tools/call",
                "params": {"name": "search", "arguments": {"api_key": "[REDACTED]", "query": "q"}},
            }
            assert out["response_payload"] == {
                "jsonrpc": "2.0",
                "id": 7,
                "result": {"content": [{"type": "text", "text": "r"}]},
            }


def test_redact_hook() -> None:
    seen: list[PayloadContext] = []

    def redact(payload: Any, context: PayloadContext) -> Any:
        seen.append(context)
        if context.kind == "response":
            return None
        payload["params"]["arguments"]["query"] = "[mine]"
        return payload

    rec = recorder(CAPTURE, redact=redact)
    rec.complete(call(rec), result={"content": []})
    out = encode(rec)
    assert out["request_payload"]["params"]["arguments"] == {"query": "[mine]"}
    assert "response_payload" not in out
    assert seen == [
        PayloadContext("request", "tools/call", "search"),
        PayloadContext("response", "tools/call", "search"),
    ]


def test_failing_redact_hook_drops_only_the_payload() -> None:
    def redact(payload: Any, context: PayloadContext) -> Any:
        raise RuntimeError("bug")

    rec = recorder(CAPTURE, redact=redact)
    rec.complete(call(rec), result={"content": []})
    out = encode(rec)
    assert out["outcome"] == "success" and "request_payload" not in out


def test_identify_hook_and_actor_display_gating() -> None:
    infos: list[RequestInfo] = []

    def identify(info: RequestInfo) -> dict[str, str]:
        infos.append(info)
        return {"id": "user-42", "name": "Ada", "email": "ada@example.com"}

    request = FakeRequest({"Authorization": f"Bearer {JWT}", "X-Tenant": "acme"})
    for config, expected in [(CAPTURE, {"name": "Ada", "email": "ada@example.com"}), (NO_CAPTURE, {})]:
        rec = recorder(config, identify=identify)
        rec.complete(call(rec, http_request=request, session_id="s"), result={})
        out = encode(rec)
        assert out["actor"] == {"token_hash": hashlib.sha256(b"user-42").hexdigest(), **expected}
    info = infos[0]
    assert info.method == "tools/call" and info.target == "search" and info.session_id == "s"
    assert info.access_token == JWT and info.headers["x-tenant"] == "acme"


def test_identify_none_or_failing_falls_back_to_the_token() -> None:
    request = FakeRequest({"Authorization": f"Bearer {JWT}"})

    def broken(info: RequestInfo) -> None:
        raise RuntimeError("bug")

    for hook in (lambda info: None, broken):
        rec = recorder(CAPTURE, identify=hook)
        rec.complete(call(rec, http_request=request), result={})
        assert encode(rec)["actor"] == {"token_hash": TOKEN_HASH, "name": "Ada", "email": "ada@example.com"}


def test_conversation_id_hook_and_constant() -> None:
    rec = recorder(conversation_id=lambda info: f"conv-{info.target}")
    rec.complete(call(rec), result={})
    assert encode(rec)["conversation_id"] == "conv-search"
    rec = recorder(conversation_id="fixed")
    rec.complete(call(rec), result={})
    assert encode(rec)["conversation_id"] == "fixed"


def test_long_values_are_clipped_to_the_edge_limits() -> None:
    rec = recorder()
    event = call(rec, name="t" * 5000, session_id="s" * 600, client=("c" * 300, "v"))
    rec.complete(event, result={})
    out = encode(rec)
    assert len(out["target"]) == 4096 and len(out["session_id"]) == 512 and len(out["client"]["name"]) == 256


def straddle(limit: int, prefix: str = "") -> str:
    """A value with an emoji (two UTF-16 code units) across ``limit`` code units."""
    return prefix + "x" * (limit - 1 - len(prefix)) + "\U0001f600tail"


def utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


def test_every_clipped_field_is_cut_by_utf16_code_units_before_an_emoji() -> None:
    # The edge counts UTF-16 code units (JavaScript string length), so an emoji
    # straddling a limit must be cut whole, never kept and never split.
    request = FakeRequest(
        {
            "Host": straddle(260),
            "User-Agent": straddle(4096),
            "Origin": straddle(2048),
            "Referer": straddle(4096),
            "X-OpenAI-Session": straddle(512),
            "MCP-Protocol-Version": straddle(64),
        },
        path=straddle(2048, "/"),
    )
    request.method = straddle(16)
    params = {
        "name": straddle(4096),
        "_meta": {"openai/subject": straddle(512), "openai/organization": straddle(512)},
    }
    rec = recorder(conversation_id=straddle(512))
    event = rec.begin(
        "tools/call",
        straddle(200),
        params,
        http_request=request,
        session_id=straddle(512),
        client=(straddle(256), straddle(256)),
    )
    rec.complete(event, error_code=-32000, error_message=straddle(500), failed=True)
    out = encode(rec)
    rec.complete(rec.begin(straddle(200, "x/"), 8, None), result={})
    method = encode(rec)["method"]
    rec.complete(call(rec), result={"isError": True, "content": [{"type": "text", "text": straddle(500)}]})
    tool_error = encode(rec)["error"]["message"]
    rec.complete(rec.begin("initialize", 9, {"clientInfo": {"name": straddle(256), "version": "1"}}), result={})
    initialize = encode(rec)

    fields: dict[str, tuple[Any, int, str]] = {
        "method": (method, 200, "x/"),
        "request_id": (out["request_id"], 200, ""),
        "target": (out["target"], 4096, ""),
        "session_id": (out["session_id"], 512, ""),
        "conversation_id": (out["conversation_id"], 512, ""),
        "protocol_version": (out["protocol_version"], 64, ""),
        "client.name": (out["client"]["name"], 256, ""),
        "client.version": (out["client"]["version"], 256, ""),
        "initialize client.name": (initialize["client"]["name"], 256, ""),
        "http.method": (out["http"]["method"], 16, ""),
        "http.path": (out["http"]["path"], 2048, "/"),
        "http.host": (out["http"]["host"], 260, ""),
        "http.user_agent": (out["http"]["user_agent"], 4096, ""),
        "http.origin": (out["http"]["origin"], 2048, ""),
        "http.referer": (out["http"]["referer"], 4096, ""),
        "openai.session": (out["openai"]["session"], 512, ""),
        "openai.subject": (out["openai"]["subject"], 512, ""),
        "openai.organization": (out["openai"]["organization"], 512, ""),
        "error.message": (out["error"]["message"], 500, ""),
        "tool error message": (tool_error, 500, ""),
    }
    for name, (value, limit, prefix) in fields.items():
        assert value == straddle(limit, prefix)[: limit - 1], name
        assert utf16_length(value) <= limit, name


def test_an_emoji_that_fits_is_kept_whole() -> None:
    target = "x" * 4094 + "\U0001f600"  # exactly 4096 code units
    rec = recorder()
    rec.complete(call(rec, name=target + "tail", session_id="\U0001f600" * 300), result={})
    out = encode(rec)
    assert out["target"] == target
    assert out["session_id"] == "\U0001f600" * 256 and utf16_length(out["session_id"]) == 512


def test_oversized_payload_uses_the_gateway_marker() -> None:
    rec = recorder(CAPTURE)
    rec.complete(call(rec), result={"content": [{"type": "text", "text": "x" * 9000} for _ in range(20)]})
    out = encode(rec)
    assert out["response_payload"]["_truncated"] is True


def test_complete_none_is_a_noop() -> None:
    rec = recorder()
    rec.complete(None, result={})
    assert rec.channel.events == []  # type: ignore[attr-defined]


def test_uuid7_is_time_ordered() -> None:
    first = uuid7()
    time.sleep(0.002)
    second = uuid7()
    assert first < second and len({uuid7() for _ in range(1000)}) == 1000


@pytest.mark.parametrize("country", ["XX", "T1", "USA", ""])
def test_invalid_countries_are_dropped(country: str) -> None:
    rec = recorder()
    rec.complete(call(rec, http_request=FakeRequest({"cf-ipcountry": country})), result={})
    assert "country" not in encode(rec)["http"]


def strict_loads(data: bytes) -> Any:
    """Parse like the ingest edge's ``JSON.parse``: ``NaN``/``Infinity`` are not JSON."""

    def reject(token: str) -> Any:
        raise ValueError(f"not JSON: {token}")

    return json.loads(data, parse_constant=reject)


def test_non_finite_numbers_from_a_client_never_make_the_batch_invalid_json() -> None:
    # 1e400 is valid JSON; Python (and pydantic) parse it as inf.
    params = json.loads(
        '{"protocolVersion":"2025-06-18","clientInfo":{"name":"x","version":"1","build":1e400,"low":-1e400}}'
    )
    for config in (NO_CAPTURE, CAPTURE):
        rec = recorder(config)
        event = rec.begin("initialize", 0, params)
        rec.complete(event, result={"serverInfo": {"name": "s", "version": "1"}, "score": float("nan")})
        envelope, body = rec.encode(event, config)
        out = strict_loads(envelope + b"[" + body + b"]}")["events"][0]
        assert out["client_info"] == {"name": "x", "version": "1", "build": None, "low": None}
        assert out["request_size"] > 0 and out["response_size"] > 0
        if config is CAPTURE:
            assert out["request_payload"]["params"]["clientInfo"]["build"] is None
            assert out["response_payload"]["result"]["score"] is None


def test_non_finite_numbers_anywhere_in_an_event_become_null() -> None:
    from mcp_use_analytics._encode import dumps

    class Model:
        def model_dump(self, **_: Any) -> dict[str, Any]:
            return {"x": float("nan"), "nested": [float("-inf")]}

    value = {"a": [1.5, float("inf")], "m": Model(), float("inf"): "key", "t": (float("nan"),)}
    expected = {"a": [1.5, None], "m": {"x": None, "nested": [None]}, "inf": "key", "t": [None]}
    assert strict_loads(dumps(value)) == expected
    rec = recorder()
    rec.complete(rec.begin("tools/call", float("inf"), {"name": "t", "arguments": {"v": float("inf")}}), result={})
    out = strict_loads(rec.encode(rec.channel.events[-1], NO_CAPTURE)[1])  # type: ignore[attr-defined]
    assert out["request_id"] is None and out["target"] == "t"


def test_response_size_is_measured_without_encoding_the_response(monkeypatch: pytest.MonkeyPatch) -> None:
    from mcp_use_analytics import _recorder

    encoded: list[int] = []
    real_dumps = _recorder.dumps

    def counting_dumps(value: Any) -> bytes:
        data = real_dumps(value)
        encoded.append(len(data))
        return data

    monkeypatch.setattr(_recorder, "dumps", counting_dumps)
    text = "é " + "x" * 3_000_000
    result = {"content": [{"type": "text", "text": text}] * 3}
    rec = recorder()
    rec.complete(call(rec), result=result)
    out = encode(rec)
    assert max(encoded) < 10_000  # only the small event itself was encoded on the delivery thread
    response = {"jsonrpc": "2.0", "id": 7, "result": result}
    exact = len(json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode())
    assert abs(out["response_size"] - exact) <= exact * 0.001, (out["response_size"], exact)


def test_identify_name_and_email_without_id_keep_the_token_hash() -> None:
    # Same as the TypeScript SDK: each key replaces only its own default.
    request = FakeRequest({"Authorization": "Bearer opaque-token-123"})
    rec = recorder(CAPTURE, identify=lambda info: {"name": "Ada", "email": "ada@x.io"})
    rec.complete(call(rec, http_request=request), result={})
    token_hash = hashlib.sha256(b"opaque-token-123").hexdigest()
    assert encode(rec)["actor"] == {"token_hash": token_hash, "name": "Ada", "email": "ada@x.io"}


def test_identify_name_and_email_without_id_or_token_send_no_actor() -> None:
    # Same as the TypeScript SDK: the edge keeps names only next to a token_hash.
    identify = lambda info: {"name": "Ada", "email": "ada@x.io"}  # noqa: E731
    for headers in ({}, {"Authorization": "Bearer mcp_api_key"}):
        rec = recorder(CAPTURE, identify=identify)
        rec.complete(call(rec, http_request=FakeRequest(headers)), result={})
        assert "actor" not in encode(rec)
    rec = recorder(CAPTURE, identify=lambda info: {"id": "u-9", "name": "Ada", "email": "ada@x.io"})
    rec.complete(call(rec, http_request=FakeRequest({})), result={})
    expected = {"token_hash": hashlib.sha256(b"u-9").hexdigest(), "name": "Ada", "email": "ada@x.io"}
    assert encode(rec)["actor"] == expected


@pytest.mark.parametrize(
    ("identity", "token_hash", "name", "email"),
    [
        ({"id": "user-42"}, hashlib.sha256(b"user-42").hexdigest(), "Ada", "ada@example.com"),
        ({"name": "Grace"}, TOKEN_HASH, "Grace", "ada@example.com"),
        ({"email": "  grace@example.com\n"}, TOKEN_HASH, "Ada", "grace@example.com"),
        ({"id": 42}, hashlib.sha256(b"42").hexdigest(), "Ada", "ada@example.com"),
        ({"id": "  u1 "}, hashlib.sha256(b"u1").hexdigest(), "Ada", "ada@example.com"),
        ({"id": "", "name": "x" * 257}, TOKEN_HASH, "Ada", "ada@example.com"),
        ({"id": True}, TOKEN_HASH, "Ada", "ada@example.com"),
        ({}, TOKEN_HASH, "Ada", "ada@example.com"),
    ],
)
def test_identify_keys_replace_only_their_own_default(
    identity: dict[str, Any], token_hash: str, name: str, email: str
) -> None:
    rec = recorder(CAPTURE, identify=lambda info: identity)
    rec.complete(call(rec, http_request=FakeRequest({"Authorization": f"Bearer {JWT}"})), result={})
    assert encode(rec)["actor"] == {"token_hash": token_hash, "name": name, "email": email}


def test_token_display_claims_are_kept_until_the_dashboard_setting_is_known() -> None:
    rec = recorder(RemoteConfig())  # nothing heard from the endpoint yet
    rec.complete(call(rec, http_request=FakeRequest({"Authorization": f"Bearer {JWT}"})), result={})
    assert encode(rec, CAPTURE)["actor"] == {"token_hash": TOKEN_HASH, "name": "Ada", "email": "ada@example.com"}


def test_token_display_claims_follow_the_setting_at_encode_time() -> None:
    # "Identify actors" was off when the request was recorded and is on when it is encoded.
    rec = recorder(NO_CAPTURE)
    rec.complete(call(rec, http_request=FakeRequest({"Authorization": f"Bearer {JWT}"})), result={})
    assert encode(rec, CAPTURE)["actor"] == {"token_hash": TOKEN_HASH, "name": "Ada", "email": "ada@example.com"}
    assert encode(rec, NO_CAPTURE)["actor"] == {"token_hash": TOKEN_HASH}


def test_dashboard_change_reaches_the_first_batch_a_minute_later(ingest: MockIngest) -> None:
    """Capture and identify turned on (then off) apply to the next batch, not the one after it."""
    clock = FakeClock()
    channel = Channel(ingest.url, API_KEY, flush_interval=60, clock=clock)
    rec = Recorder(channel, Options(), framework="test", framework_version="1.0", server_info={"name": "srv"})
    request = FakeRequest({"Authorization": f"Bearer {JWT}"})

    def record() -> dict[str, Any]:
        sent = len(ingest.events)
        rec.complete(call(rec, http_request=request), result={"content": [{"type": "text", "text": "ok"}]})
        assert channel.flush(5)
        (event,) = ingest.events[sent:]
        return event

    before = record()
    assert {"request_payload", "response_payload"}.isdisjoint(before)
    assert before["actor"] == {"token_hash": TOKEN_HASH}

    ingest.config = {"capture_payloads": True, "identify_actors": True}
    clock.advance(CONFIG_MAX_AGE + 1)
    on = record()
    assert on["request_payload"]["params"] == {"name": "search", "arguments": {"query": "q"}}
    assert on["response_payload"]["result"] == {"content": [{"type": "text", "text": "ok"}]}
    assert on["actor"] == {"token_hash": TOKEN_HASH, "name": "Ada", "email": "ada@example.com"}

    ingest.config = {"capture_payloads": False, "identify_actors": False}
    clock.advance(CONFIG_MAX_AGE + 1)
    off = record()
    assert {"request_payload", "response_payload"}.isdisjoint(off)
    assert off["actor"] == {"token_hash": TOKEN_HASH}
    assert sum(1 for r in ingest.requests if r.method == "GET") == 3


def test_abandoned_request_has_no_outcome() -> None:
    rec = recorder()
    event = call(rec, transport="stdio")
    rec.abandon(event)
    out = encode(rec)
    assert {"outcome", "error", "response_size", "response_payload"}.isdisjoint(out), out
    assert out["method"] == "tools/call" and out["duration_ms"] >= 0 and out["request_size"] > 0
