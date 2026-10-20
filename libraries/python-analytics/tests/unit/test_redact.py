from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from mcp_use_analytics import redact_payload
from mcp_use_analytics._redact import MAX_PAYLOAD_CHARS, REDACTED, bound_payload, is_sensitive_key

# Shared with @mcp-use/analytics: both default redactors must pass the same vectors.
VECTORS = json.loads((Path(__file__).parent.parent / "fixtures" / "redaction_vectors.json").read_text())


@pytest.mark.parametrize(
    "key",
    [
        "password",
        "db_password",
        "apiKey",
        "X-API-Key",
        "api_key",
        "access_token",
        "refreshToken",
        "client_secret",
        "Authorization",
        "cookie",
        "set-cookie",
        "private_key",
        "aws_secret_access_key",
        "credentials",
        "ssn",
        "pin",
    ],
)
def test_sensitive_keys(key: str) -> None:
    assert is_sensitive_key(key)


@pytest.mark.parametrize(
    "key", ["max_tokens", "output_tokens", "token_count", "author", "name", "text", "uri", "pinned"]
)
def test_ordinary_keys(key: str) -> None:
    assert not is_sensitive_key(key)


def test_redacts_nested_values_without_mutating_input() -> None:
    payload = {"params": {"arguments": {"password": "hunter2", "query": "hello", "nested": [{"apiKey": "k"}]}}}
    original = json.dumps(payload)
    redacted = redact_payload(payload)
    assert redacted == {
        "params": {"arguments": {"password": REDACTED, "query": "hello", "nested": [{"apiKey": REDACTED}]}}
    }
    assert json.dumps(payload) == original


def test_credential_looking_strings() -> None:
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJl"
    assert redact_payload({"note": jwt}) == {"note": REDACTED}
    assert redact_payload(["Bearer abcdefghijklmnopqrstuvwxyz"]) == [REDACTED]
    assert redact_payload("Bearer of good news") == "Bearer of good news"


def test_binaries() -> None:
    payload = {
        "content": [
            {"type": "image", "data": "aGVsbG8gd29ybGQ=", "mimeType": "image/png"},
            {"type": "text", "text": "kept"},
            {"type": "resource", "resource": {"uri": "file://a", "blob": "AAAA"}},
        ],
        "raw": b"\x00\x01\x02",
    }
    assert redact_payload(payload) == {
        "content": [
            {"type": "image", "data": "[binary 11 bytes]", "mimeType": "image/png"},
            {"type": "text", "text": "kept"},
            {"type": "resource", "resource": {"uri": "file://a", "blob": "[binary 3 bytes]"}},
        ],
        "raw": "[binary 3 bytes]",
    }


def test_long_strings_cycles_and_depth() -> None:
    cycle: dict[str, Any] = {"a": 1}
    cycle["self"] = cycle
    deep: Any = "bottom"
    for _ in range(50):
        deep = [deep]
    out = redact_payload({"long": "x" * 20, "cycle": cycle, "deep": deep}, max_string_length=10, max_depth=5)
    assert out["long"] == "x" * 10 + "…[truncated 10 chars]"
    assert out["cycle"] == {"a": 1, "self": "[Circular]"}
    assert out["deep"] == [[[["[MaxDepth]"]]]]  # the root dict is depth 0


def test_non_json_values() -> None:
    @dataclass
    class Point:
        x: int
        password: str

    class Model:
        def model_dump(self, **_: Any) -> dict[str, Any]:
            return {"secret": "s", "ok": True}

    out = redact_payload({"p": Point(1, "pw"), "m": Model(), "s": {3}, "n": float("nan"), "o": object()})
    assert out["p"] == {"x": 1, "password": REDACTED}
    assert out["m"] == {"secret": REDACTED, "ok": True}
    assert out["s"] == [3] and out["n"] is None
    assert out["o"].startswith("<object object at")
    json.dumps(out, allow_nan=False)


def test_bound_payload_matches_gateway_marker() -> None:
    small = {"text": "ok"}
    assert bound_payload(small) is small
    big = {"text": "x" * (MAX_PAYLOAD_CHARS + 1)}
    bounded = bound_payload(big)
    assert bounded["_truncated"] is True and bounded["_message"].startswith("Payload too large (")
    assert bound_payload(None) is None


@pytest.mark.parametrize("key", VECTORS["sensitive_keys"])
def test_shared_vectors_sensitive_keys(key: str) -> None:
    assert is_sensitive_key(key)


@pytest.mark.parametrize("key", VECTORS["ordinary_keys"])
def test_shared_vectors_ordinary_keys(key: str) -> None:
    assert not is_sensitive_key(key)


@pytest.mark.parametrize("case", VECTORS["cases"], ids=lambda case: case["name"])
def test_shared_vectors(case: dict[str, Any]) -> None:
    payload = json.loads(case["input_json"]) if "input_json" in case else case["input"]
    redacted = redact_payload(payload)
    assert redacted == case["expected"]
    json.dumps(redacted, allow_nan=False)


def test_infinity_is_not_json() -> None:
    out = redact_payload({"a": float("inf"), "b": [float("-inf")], "c": float("nan")})
    assert out == {"a": None, "b": [None], "c": None}
