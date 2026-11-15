"""Actor identity hashing, byte-for-byte compatible with the Manufact gateway.

The gateway hashes the end user's Bearer token into an opaque correlation key
(``tokenIdentityHash`` in the gateway's ``mcp-classify.ts``): the SHA-256 of
``iss + NUL + sub`` when the token is a JWT carrying both claims, otherwise the
SHA-256 of the raw token. Computing the same value here links an end user's SDK
events to their gateway events. The raw token never leaves the process.

JWT claims are read without verifying the signature: this is analytics
correlation, not authorization.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
from typing import Any

# WHATWG forgiving-base64 (the algorithm behind JS `atob`) strips ASCII whitespace.
_ASCII_WHITESPACE = re.compile(r"[\t\n\f\r ]")
_BASE64_ALPHABET = re.compile(r"^[A-Za-z0-9+/]*$")
_LONE_SURROGATE = re.compile(r"[\ud800-\udfff]")
_CONTROL = re.compile(r"[\u0000-\u001f\u007f]")
# The code points JS `String.prototype.trim` removes (ECMAScript WhiteSpace and
# LineTerminator). Python's `str.strip()` differs: it also removes U+001C-U+001F
# and U+0085, and keeps U+FEFF.
_JS_TRIM_CHARS = "\t\n\x0b\x0c\r                  　﻿"


def _atob(data: str) -> bytes | None:
    """Decode like JS ``atob``; ``None`` where ``atob`` would throw."""
    data = _ASCII_WHITESPACE.sub("", data)
    if len(data) % 4 == 0:
        if data.endswith("=="):
            data = data[:-2]
        elif data.endswith("="):
            data = data[:-1]
    if len(data) % 4 == 1 or not _BASE64_ALPHABET.match(data):
        return None
    try:
        return base64.b64decode(data + "=" * (-len(data) % 4))
    except ValueError:
        return None


def _reject_constant(value: str) -> Any:
    # JSON.parse has no NaN/Infinity literals; json.loads accepts them by default.
    raise ValueError(value)


def _jwt_claims(token: str, *, utf8: bool = False) -> dict[str, Any] | None:
    """The JWT payload object, decoded the way the gateway does (or ``None``)."""
    segments = token.split(".")
    if len(segments) != 3 or not segments[1]:
        return None
    b64 = segments[1].replace("-", "+").replace("_", "/")
    raw = _atob(b64 + "=" * ((4 - len(b64) % 4) % 4))
    if raw is None:
        return None
    # The gateway parses the `atob` binary string directly (each byte is one
    # char, i.e. latin-1) for identity hashes, and UTF-8 for display claims
    # (TextDecoder, which drops a leading BOM and replaces invalid sequences).
    if utf8:
        text = raw.removeprefix(b"\xef\xbb\xbf").decode("utf-8", errors="replace")
    else:
        text = raw.decode("latin-1")
    try:
        parsed = json.loads(text, parse_constant=_reject_constant)
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _utf8(value: str) -> bytes:
    # TextEncoder replaces lone surrogates with U+FFFD instead of failing.
    return _LONE_SURROGATE.sub("�", value).encode("utf-8")


def sha256_hex(value: str) -> str:
    """Lowercase hex SHA-256 of the UTF-8 encoding of ``value``."""
    return hashlib.sha256(_utf8(value)).hexdigest()


def token_identity_hash(token: str) -> str:
    """Stable identity hash of a Bearer token, identical to the gateway's.

    Args:
        token: The raw token (the ``Authorization`` header value after ``Bearer ``).

    Returns:
        ``sha256_hex(iss + "\\0" + sub)`` for a JWT with a string ``iss`` and a
        non-empty string ``sub``, else ``sha256_hex(token)``.
    """
    claims = _jwt_claims(token)
    if claims is not None:
        iss, sub = claims.get("iss"), claims.get("sub")
        if isinstance(iss, str) and isinstance(sub, str) and sub:
            return sha256_hex(f"{iss}\u0000{sub}")
    return sha256_hex(token)


def _utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def display_claim(value: Any, limit: int) -> str | None:
    """``value`` without control characters and trimmed like JS, or ``None``.

    ``None`` when it is not a string, empty, or longer than ``limit`` UTF-16 code
    units: the gateway's (and the TypeScript SDK's) ``displayClaim``.
    """
    if not isinstance(value, str):
        return None
    cleaned = _CONTROL.sub("", value).strip(_JS_TRIM_CHARS)
    return cleaned if cleaned and _utf16_length(cleaned) <= limit else None


def token_display_metadata(token: str) -> tuple[str | None, str | None]:
    """The allowlisted ``name`` and ``email`` JWT claims, cleaned like the gateway.

    These are only sent when the server's "identify actors" dashboard setting is on.
    """
    claims = _jwt_claims(token, utf8=True) or {}
    return display_claim(claims.get("name"), 256), display_claim(claims.get("email"), 320)


def bearer_token(authorization: str | None) -> str | None:
    """The token of an ``Authorization: Bearer`` header, as the gateway reads it.

    The gateway's own ``mcp_`` API keys are not end-user identities and are skipped.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    if not token or token.startswith("mcp_"):
        return None
    return token
