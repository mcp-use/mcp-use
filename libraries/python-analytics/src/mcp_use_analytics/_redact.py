"""Default payload redaction, applied before any payload leaves the process.

Payloads are only captured when the server's dashboard setting is on and the
local ``capture_payloads`` option is not ``False``. Even then, every request
and response payload goes through :func:`redact_payload` first and then the
user's ``redact`` hook:

- values under sensitive keys (passwords, secrets, tokens, API keys, cookies,
  authorization, private keys, ...) become ``"[REDACTED]"``;
- strings that look like credentials (``Bearer ...``, JWTs) become ``"[REDACTED]"``;
- binary data (``bytes``, and base64 ``data``/``blob`` of MCP image, audio and
  resource contents) becomes a short ``"[binary N bytes]"`` marker;
- strings longer than ``max_string_length`` are cut with a marker;
- cycles become ``"[Circular]"`` and nesting deeper than ``max_depth`` ``"[MaxDepth]"``;
- ``NaN`` and ``Infinity`` become ``None`` (``null``, like ``JSON.stringify``);
- non-JSON values (pydantic models, dataclasses, sets, ...) become JSON values.

The TypeScript package applies the same rules; ``tests/fixtures/redaction_vectors.json``
holds the vectors both test suites check.

The serialized result is bounded like the gateway's own capture: anything over
``MAX_PAYLOAD_CHARS`` is replaced by ``{"_truncated": true, "_message": ...}``.
"""

from __future__ import annotations

import dataclasses
import json
import math
import re
from collections.abc import Mapping
from typing import Any

REDACTED = "[REDACTED]"
MAX_PAYLOAD_CHARS = 100_000
DEFAULT_MAX_STRING_LENGTH = 10_000
DEFAULT_MAX_DEPTH = 32

# Keys are compared lowercased with separators removed (`api-key`, `apiKey`,
# `API_KEY` all become `apikey`). Suffix matches catch `github_token`,
# `db_password`, `x-api-key`; exact matches catch short or ambiguous names.
_SENSITIVE_SUFFIXES = (
    "password",
    "passwd",
    "passphrase",
    "secret",
    "token",
    "apikey",
    "privatekey",
    "credential",
    "credentials",
    "cookie",
    "cookies",
    "authorization",
    "signature",
    "accesskey",
)
_SENSITIVE_EXACT = frozenset({"auth", "pwd", "pin", "otp", "ssn", "cvv", "cvc", "cardnumber", "creditcard"})
_KEY_SEPARATORS = re.compile(r"[^a-z0-9]")
_CREDENTIAL_VALUE = re.compile(
    r"^(?:Bearer\s+[A-Za-z0-9._~+/=-]{16,}|eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*|mfi_[A-Za-z0-9]{20,})$",
    re.IGNORECASE,
)
# MCP content blocks carry binaries as base64 strings.
_BINARY_FIELDS = {"image": "data", "audio": "data"}


class _Circular:
    pass


def is_sensitive_key(key: str) -> bool:
    """Whether a mapping key names a value that must never be captured."""
    normalized = _KEY_SEPARATORS.sub("", key.lower())
    if not normalized:
        return False
    return normalized in _SENSITIVE_EXACT or normalized.endswith(_SENSITIVE_SUFFIXES)


def _binary_marker(size: int) -> str:
    return f"[binary {size} bytes]"


def _base64_marker(value: str) -> str:
    # Decoded size without decoding: 3 bytes per 4 characters, minus padding.
    stripped = value.rstrip("=")
    return _binary_marker(len(stripped) * 3 // 4)


def _truncate(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return f"{value[:limit]}…[truncated {len(value) - limit} chars]"


class _Redactor:
    def __init__(self, max_string_length: int, max_depth: int) -> None:
        self.max_string_length = max_string_length
        self.max_depth = max_depth
        self._stack: set[int] = set()

    def value(self, obj: Any, depth: int) -> Any:
        if obj is None or isinstance(obj, (bool, int)):
            return obj
        if isinstance(obj, float):
            return obj if math.isfinite(obj) else None  # NaN and Infinity are not JSON
        if isinstance(obj, str):
            if _CREDENTIAL_VALUE.match(obj):
                return REDACTED
            return _truncate(obj, self.max_string_length)
        if isinstance(obj, (bytes, bytearray, memoryview)):
            return _binary_marker(len(obj))
        if depth >= self.max_depth:
            return "[MaxDepth]"
        converted = _to_container(obj)
        if converted is None:
            return _truncate(_safe_str(obj), self.max_string_length)
        marker = id(obj)
        if marker in self._stack:
            return "[Circular]"
        self._stack.add(marker)
        try:
            if isinstance(converted, Mapping):
                return self.mapping(converted, depth)
            return [self.value(item, depth + 1) for item in converted]
        finally:
            self._stack.discard(marker)

    def mapping(self, obj: Mapping[Any, Any], depth: int) -> dict[str, Any]:
        out: dict[str, Any] = {}
        binary_field = _BINARY_FIELDS.get(obj.get("type")) if isinstance(obj.get("type"), str) else None
        for raw_key, item in obj.items():
            key = raw_key if isinstance(raw_key, str) else _safe_str(raw_key)
            if is_sensitive_key(key):
                out[key] = REDACTED
            elif isinstance(item, str) and (key == binary_field or key == "blob"):
                out[key] = _base64_marker(item)
            else:
                out[key] = self.value(item, depth + 1)
        return out


def _safe_str(obj: Any) -> str:
    try:
        return str(obj)
    except Exception:
        return f"<{type(obj).__name__}>"


def _to_container(obj: Any) -> Mapping[Any, Any] | list[Any] | None:
    """A JSON-shaped view of ``obj`` (mapping or list), or ``None`` for scalars."""
    if isinstance(obj, Mapping):
        return obj
    if isinstance(obj, (list, tuple, set, frozenset)):
        return list(obj)
    dump = getattr(obj, "model_dump", None)
    if callable(dump):  # pydantic v2 models (every MCP type)
        try:
            dumped = dump(mode="json", by_alias=True, exclude_none=True)
        except Exception:
            return None
        return dumped if isinstance(dumped, (Mapping, list)) else None
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {field.name: getattr(obj, field.name, None) for field in dataclasses.fields(obj)}
    return None


def redact_payload(
    payload: Any,
    *,
    max_string_length: int = DEFAULT_MAX_STRING_LENGTH,
    max_depth: int = DEFAULT_MAX_DEPTH,
) -> Any:
    """Apply the default redaction rules to a payload and return a JSON value.

    Args:
        payload: Any value (dicts, lists, pydantic models, dataclasses, scalars).
        max_string_length: Strings longer than this are truncated with a marker.
        max_depth: Containers nested deeper than this are replaced by ``"[MaxDepth]"``.

    Returns:
        A new JSON-serializable value; ``payload`` is never modified.
    """
    return _Redactor(max_string_length, max_depth).value(payload, 0)


def bound_payload(payload: Any) -> Any:
    """Bound a JSON value at ``MAX_PAYLOAD_CHARS`` serialized characters.

    Mirrors the gateway's capture marker so oversized payloads look the same
    whichever source recorded them.
    """
    if payload is None:
        return None
    try:
        size = len(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False))
    except (TypeError, ValueError):
        return {"_truncated": True, "_message": "Payload serialization failed"}
    if size > MAX_PAYLOAD_CHARS:
        return {"_truncated": True, "_message": f"Payload too large ({size} bytes)"}
    return payload
