"""Shared pieces of the per-framework integration tests.

Every framework test builds the same small server (``add``, ``soft_fail``,
``boom``, ``echo``, one resource, one prompt), drives it with a real MCP client
over a real transport, records what the *client* observed for each request,
and checks that the events the mock ingest received say the same thing.
"""

from __future__ import annotations

import base64
import hashlib
import json
import socket
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

import uvicorn
from mock_ingest import API_KEY

import mcp_use_analytics
from mcp_use_analytics._transport import CONFIG_MAX_AGE

RESOURCE_URI = "res://greeting"
PROMPT_NAME = "greet"


def _b64url(data: str) -> str:
    return base64.urlsafe_b64encode(data.encode()).decode().rstrip("=")


# The cross-SDK actor test vector: a JWT for iss/sub hashes to sha256(iss NUL sub).
_CLAIMS = {"iss": "https://issuer.example", "sub": "user_123"}
JWT = f"{_b64url(json.dumps({'alg': 'none'}))}.{_b64url(json.dumps(_CLAIMS))}.sig"
TOKEN_HASH = hashlib.sha256(b"https://issuer.example\x00user_123").hexdigest()
assert TOKEN_HASH == "2a5fc66f3aa0656ef3f43f2112b9e6f824ec500ff5a667b9fbf5bca0b3f4c4a3"
# The same actor (same TOKEN_HASH) with the display claims "identify actors" sends.
ACTOR_NAME, ACTOR_EMAIL = "Ada Lovelace", "ada@example.com"
NAMED_JWT = (
    f"{_b64url(json.dumps({'alg': 'none'}))}."
    f"{_b64url(json.dumps({**_CLAIMS, 'name': ACTOR_NAME, 'email': ACTOR_EMAIL}))}.sig"
)


def instrument(server: Any, ingest: Any, **options: Any) -> Any:
    return mcp_use_analytics.instrument(server, api_key=API_KEY, endpoint=ingest.url, **options)


@dataclass(frozen=True)
class Seen:
    """What the client observed for one request."""

    method: str
    target: str | None = None
    outcome: str = "success"
    code: int | None = None
    # The error text the client got (isError text blocks, or the JSON-RPC message).
    message: str | None = field(default=None, compare=False)


@contextmanager
def serve_http(app: Any) -> Iterator[str]:
    """Serve an ASGI app with uvicorn on an ephemeral 127.0.0.1 port; yields the base URL."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    config = uvicorn.Config(app, log_level="warning", lifespan="on", timeout_graceful_shutdown=2)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        if time.monotonic() > deadline or not thread.is_alive():
            raise RuntimeError("uvicorn did not start")
        time.sleep(0.01)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        sock.close()


async def run_scenarios(driver: Any) -> list[Seen]:
    """The standard request sequence; ``initialize`` already happened on connect."""
    seen = [Seen("initialize")]
    seen.append(await driver.list_tools())
    seen.append(await driver.call_tool("add", {"a": 2, "b": 3}))
    seen.append(await driver.call_tool("soft_fail", {}))
    seen.append(await driver.call_tool("boom", {}))
    seen.append(await driver.call_tool("nope", {}))
    seen.append(await driver.read_resource(RESOURCE_URI))
    seen.append(await driver.get_prompt(PROMPT_NAME, {"name": "Ada"}))
    return seen


def flush_and_get(ingest: Any, expected: int, timeout: float = 10.0) -> list[dict[str, Any]]:
    assert mcp_use_analytics.flush(timeout), "flush timed out"
    ingest.wait_for(lambda i: len(i.events) >= expected, timeout=2)
    return ingest.events


def _key(event: dict[str, Any]) -> tuple[Any, ...]:
    rid = event.get("request_id")
    return (event["time"], rid if isinstance(rid, int) else 0)


def assert_events_match(
    events: list[dict[str, Any]],
    seen: list[Seen],
    *,
    client_name: str | None,
    transport: str,
    stateless: bool | None = False,
    token_hash: str | None = None,
    initialize: bool = True,
) -> list[dict[str, Any]]:
    """Each request the client made has exactly one event that agrees with what the client saw."""
    mine = sorted(
        (e for e in events if client_name is None or (e.get("client") or {}).get("name") == client_name),
        key=_key,
    )
    if not initialize:
        seen = [s for s in seen if s.method != "initialize"]
    observed = [(e["method"], e.get("target"), e["outcome"], (e.get("error") or {}).get("code")) for e in mine]
    expected = [(s.method, s.target, s.outcome, s.code if s.outcome == "error" else None) for s in seen]
    # Clients may send extra tools/list on their own (mcp's output-schema
    # validation refreshes it), so tools/list rows are counted, not ordered.
    assert [row for row in observed if row[0] != "tools/list"] == [row for row in expected if row[0] != "tools/list"], (
        f"observed {observed}\nexpected {expected}"
    )
    lists = [row for row in observed if row[0] == "tools/list"]
    assert lists and all(row == ("tools/list", None, "success", None) for row in lists), observed
    for event, saw in zip(
        [e for e in mine if e["method"] != "tools/list"], [s for s in seen if s.method != "tools/list"], strict=True
    ):
        if saw.outcome != "success":
            assert event["error"].get("message") == (saw.message or None), (event, saw)

    ids = [e["id"] for e in mine]
    assert len(ids) == len(set(ids)), "event ids must be unique"
    sessions = {e.get("session_id") for e in mine}
    if stateless:
        assert sessions == {None}, sessions
    else:
        assert len(sessions) == 1 and None not in sessions, sessions
    for event in mine:
        assert event["transport"] == transport, event
        assert event.get("stateless") == stateless, event
        assert event["duration_ms"] >= 0
        assert event["time"].endswith("Z")
        assert "request_payload" not in event and "response_payload" not in event
        if token_hash is not None:
            assert event["actor"] == {"token_hash": token_hash}, event
        if transport != "stdio":
            assert event["http"]["method"] == "POST" and event["http"]["host"].startswith("127.0.0.1:"), event
        if event["outcome"] == "tool_error":
            assert event["error"]["message"], event
    if initialize:
        init = next(e for e in mine if e["method"] == "initialize")
        assert init["client_info"]["name"] == (client_name or init["client"]["name"])
        assert init["protocol_version"]
    return mine


def assert_recorded_once(events: list[dict[str, Any]]) -> None:
    """One event per JSON-RPC request: no (session, request id) pair twice."""
    keys = [(e.get("session_id"), e["request_id"]) for e in events]
    assert len(keys) == len(set(keys)), keys
    assert sum(1 for e in events if e["method"] == "tools/call") == 1, events
    assert sum(1 for e in events if e["method"] == "initialize") == 1, events


def assert_batches(ingest: Any, framework: str) -> None:
    for batch in ingest.batches:
        assert batch["schema"] == "manufact.sdk.v1"
        assert batch["sdk"]["name"] == "mcp-use-analytics"
        assert batch["sdk"]["language"] == "python"
        assert batch["sdk"]["framework"] == framework, batch["sdk"]
        assert batch["sdk"]["framework_version"]
        assert batch["sdk"]["runtime"].startswith("python/")
        assert batch["server"]["name"] == "analytics-test"
    for request in ingest.requests:
        assert request.headers["authorization"] == f"Bearer {API_KEY}"


async def assert_dashboard_change_reaches_the_next_batch(ingest: Any, config_clock: Any, driver: Any) -> None:
    """Capture and identify turned on in the dashboard apply to the first batch recorded a minute later.

    ``driver`` is connected with ``Authorization: Bearer NAMED_JWT``; ``config_clock``
    ages the channel's settings, so no test waits a real minute.
    """
    await driver.call_tool("echo", {"password": "hunter2", "text": "visible"})
    before = flush_and_get(ingest, 2)
    assert before and all("request_payload" not in e and set(e["actor"]) == {"token_hash"} for e in before), before

    ingest.config = {"capture_payloads": True, "identify_actors": True}
    config_clock.advance(CONFIG_MAX_AGE + 1)
    await driver.call_tool("echo", {"password": "hunter2", "text": "visible"})
    after = flush_and_get(ingest, len(before) + 1)[len(before) :]
    echo = next(e for e in after if e.get("target") == "echo")
    assert echo["request_payload"]["params"]["arguments"] == {"password": "[REDACTED]", "text": "visible"}
    assert "visible" in json.dumps(echo["response_payload"])
    assert echo["actor"] == {"token_hash": TOKEN_HASH, "name": ACTOR_NAME, "email": ACTOR_EMAIL}
    assert all("request_payload" in e and e["actor"].get("name") == ACTOR_NAME for e in after), after
    assert [r.path for r in ingest.requests if r.method == "GET"] == ["/v1/config"] * 2


def assert_payloads(events: list[dict[str, Any]]) -> None:
    """With capture on: full JSON-RPC messages, sensitive keys redacted."""
    echo = next(e for e in events if e.get("target") == "echo")
    request = echo["request_payload"]
    assert request["method"] == "tools/call" and request["jsonrpc"] == "2.0"
    assert request["params"]["arguments"] == {"password": "[REDACTED]", "text": "visible"}
    response = echo["response_payload"]
    assert "result" in response and response["id"] == echo["request_id"]
    assert "visible" in json.dumps(response) and "hunter2" not in json.dumps(response)
    listing = next(e for e in events if e["method"] == "tools/list")
    assert {tool["name"] for tool in listing["response_payload"]["result"]["tools"]} >= {"add", "echo"}
