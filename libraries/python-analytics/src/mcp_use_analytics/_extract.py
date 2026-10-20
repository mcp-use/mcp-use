"""Pure helpers that read analytics fields off raw JSON-RPC messages and HTTP requests.

They mirror what the gateway extracts for the same exchange (``mcp-classify.ts``
``extractMeta`` and the outcome rules in ``middleware/observability.ts``) so SDK
rows and gateway rows mean the same thing.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

GATEWAY_REQUEST_HEADER = "x-gateway-request-id"
MAX_ERROR_MESSAGE = 500

# Limits the ingest edge enforces per field; longer values would get the whole
# event rejected, so they are clipped here instead. The edge validates in
# JavaScript, so lengths are UTF-16 code units (an emoji counts twice): see cut().
LIMITS = {
    "method": 200,
    "request_id": 200,
    "target": 4096,
    "session_id": 512,
    "conversation_id": 512,
    "client": 256,
    "protocol_version": 64,
    "http.method": 16,
    "http.path": 2048,
    "http.host": 260,
    "http.user_agent": 4096,
    "http.origin": 2048,
    "http.referer": 4096,
    "openai": 512,
}

_TARGET_KEYS = {"tools/call": "name", "prompts/get": "name", "resources/read": "uri"}
_COUNTRY = re.compile(r"^[A-Z]{2}$")
_TRACEPARENT = re.compile(r"^[0-9a-f]+$", re.IGNORECASE)
_COUNTRY_HEADERS = ("cf-ipcountry", "x-vercel-ip-country", "cloudfront-viewer-country")


def cut(text: str, limit: int) -> str:
    """``text`` cut to at most ``limit`` UTF-16 code units, never inside a surrogate pair.

    The ingest edge checks lengths in JavaScript, where a character outside the
    Basic Multilingual Plane (most emoji) is two code units, and rejects the
    whole event when a field is too long. Cutting by Python characters could
    leave such a value over the limit; this cuts like the TypeScript SDK.
    """
    if len(text) <= limit // 2:  # fits even if every character takes two units
        return text
    if text.isascii():
        return text[:limit]
    head = text[:limit]  # the result is a prefix of this
    units = head.encode("utf-16-le", "surrogatepass")
    if len(head) == len(text) and len(units) <= 2 * limit:
        return text
    units = units[: 2 * limit]
    if 0xD800 <= int.from_bytes(units[-2:], "little") <= 0xDBFF:
        units = units[:-2]  # the first half of a pair cut in two
    return units.decode("utf-16-le", "surrogatepass")


def clip(value: Any, limit: int) -> str | None:
    """A non-empty stripped string of at most ``limit`` UTF-16 code units, else ``None``."""
    if value is None:
        return None
    text = value if isinstance(value, str) else str(value)
    text = text.strip()
    return (cut(text, limit) if text else None) or None


def protocol_version(value: Any) -> str | None:
    """A ``protocolVersion`` value, clipped like the edge does."""
    return clip(value, LIMITS["protocol_version"])


def as_mapping(value: Any) -> Mapping[str, Any] | None:
    return value if isinstance(value, Mapping) else None


def target_of(method: str, params: Mapping[str, Any] | None) -> str | None:
    """Tool name, resource URI or prompt name for the methods that have one."""
    key = _TARGET_KEYS.get(method)
    if key is None or params is None:
        return None
    return clip(params.get(key), LIMITS["target"])


def meta_of(params: Mapping[str, Any] | None) -> Mapping[str, Any]:
    meta = params.get("_meta") if params is not None else None
    return meta if isinstance(meta, Mapping) else {}


def client_from_info(info: Any) -> tuple[str | None, str | None] | None:
    """``(name, version)`` from a ``clientInfo`` object (dict or pydantic model)."""
    if info is None:
        return None
    if isinstance(info, Mapping):
        name, version = info.get("name"), info.get("version")
    else:
        name, version = getattr(info, "name", None), getattr(info, "version", None)
    name = clip(name, LIMITS["client"])
    if name is None:
        return None
    return name, clip(version, LIMITS["client"])


def client_from_meta(meta: Mapping[str, Any]) -> tuple[str | None, str | None] | None:
    """Client identity of 2026-era requests, sent in every request's ``_meta``."""
    return client_from_info(
        meta.get("io.modelcontextprotocol/clientInfo") or meta.get("modelcontextprotocol/clientInfo")
    )


def dump_model(value: Any) -> Any:
    """A plain JSON value for a pydantic model (camelCase wire aliases), else ``value``."""
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        try:
            return dump(mode="json", by_alias=True, exclude_none=True)
        except Exception:
            return None
    return value


def header(headers: Any, name: str) -> str | None:
    """A header value from any ``.get``-able, case-insensitive headers object."""
    if headers is None:
        return None
    try:
        value = headers.get(name)
    except Exception:
        return None
    return value if isinstance(value, str) and value else None


def openai_of(meta: Mapping[str, Any], headers: Any) -> dict[str, str] | None:
    """ChatGPT's correlation hints: ``_meta`` keys first, then mirrored headers."""
    limit = LIMITS["openai"]
    result = {
        "session": clip(meta.get("openai/session"), limit) or clip(header(headers, "x-openai-session"), limit),
        "subject": clip(meta.get("openai/subject"), limit) or clip(header(headers, "x-openai-subject"), limit),
        "organization": clip(meta.get("openai/organization"), limit),
    }
    location = meta.get("openai/userLocation")
    if isinstance(location, Mapping):
        result["country"] = country_code(location.get("country"))
    compact = {key: value for key, value in result.items() if value}
    return compact or None


def country_code(value: Any) -> str | None:
    """ISO-3166 alpha-2, uppercased; anything else (``XX``, ``T1``, junk) is dropped."""
    if not isinstance(value, str):
        return None
    code = value.strip().upper()
    return code if _COUNTRY.match(code) and code != "XX" else None


def trace_id_of(meta: Mapping[str, Any], headers: Any) -> str | None:
    """Trace id from a W3C ``traceparent`` in ``_meta`` or the HTTP headers."""
    for traceparent in (meta.get("traceparent"), header(headers, "traceparent")):
        if isinstance(traceparent, str):
            parts = traceparent.strip().split("-")
            if len(parts) >= 2 and parts[1] and len(parts[1]) <= 64 and _TRACEPARENT.match(parts[1]):
                return parts[1].lower()
    return None


def http_of(request: Any) -> tuple[dict[str, str], Any] | None:
    """``(http fields, headers)`` of a Starlette-style request, or ``None`` off HTTP."""
    if request is None:
        return None
    headers = getattr(request, "headers", None)
    url = getattr(request, "url", None)
    fields: dict[str, Any] = {
        "method": clip(getattr(request, "method", None), LIMITS["http.method"]),
        "path": clip(getattr(url, "path", None), LIMITS["http.path"]),
        "host": clip(header(headers, "x-forwarded-host") or header(headers, "host"), LIMITS["http.host"]),
        "user_agent": clip(header(headers, "user-agent"), LIMITS["http.user_agent"]),
        "origin": clip(header(headers, "origin"), LIMITS["http.origin"]),
        "referer": clip(header(headers, "referer"), LIMITS["http.referer"]),
    }
    if fields["host"] and "," in fields["host"]:
        fields["host"] = fields["host"].split(",")[0].strip()
    for name in _COUNTRY_HEADERS:
        code = country_code(header(headers, name))
        if code:
            fields["country"] = code
            break
    return {key: value for key, value in fields.items() if value}, headers


def headers_dict(headers: Any) -> dict[str, str]:
    """Lowercased copy of a headers object, for user hooks."""
    if headers is None:
        return {}
    try:
        return {str(key).lower(): str(value) for key, value in headers.items()}
    except Exception:
        return {}


def tool_error_text(result: Mapping[str, Any]) -> str | None:
    """The gateway's message for an ``isError`` result: its text blocks joined by newlines."""
    content = result.get("content")
    if not isinstance(content, list):
        return None
    parts = []
    for block in content:
        if isinstance(block, Mapping) and block.get("type") == "text":
            text = block.get("text")
            if text:
                parts.append(str(text))
    return cut("\n".join(parts), MAX_ERROR_MESSAGE) or None


def is_error_result(result: Any) -> bool:
    return isinstance(result, Mapping) and (result.get("isError") is True or result.get("is_error") is True)


def error_message(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return cut(text, MAX_ERROR_MESSAGE) or None
