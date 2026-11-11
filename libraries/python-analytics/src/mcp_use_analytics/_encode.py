"""Event JSON: strict encoding, and the size of a message without encoding it.

The ingest edge parses each batch with ``JSON.parse``, which has no ``NaN`` or
``Infinity``. Python's ``json`` writes those tokens by default, so one
non-finite number anywhere in one event (a client's ``1e400`` parses to
``inf``) would make the whole batch invalid JSON and get it dropped.
:func:`dumps` therefore encodes with ``allow_nan=False`` and, when a value is
not finite, writes it as ``null`` (what ``JSON.stringify`` does).

:func:`json_size` measures ``request_size``/``response_size`` without encoding
the message: ``json.dumps`` runs in C and holds the GIL for the whole call, so
encoding a multi-megabyte response just to count its bytes would stall the
server's event loop while the delivery thread works.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from json.encoder import encode_basestring, encode_basestring_ascii
from typing import Any

from . import _extract as ex

# json_size measures exactly up to these sizes and samples beyond them.
LONG_STRING = 4096
STRING_SAMPLES = 8
SAMPLE_CHARS = 512
WIDE_CONTAINER = 512
CONTAINER_SAMPLES = 256
MAX_DEPTH = 64
# CPython's default sys.get_int_max_str_digits(): json cannot print longer ints.
_MAX_INT_DIGITS = 4300


def json_default(value: Any) -> Any:
    """The JSON value for a non-JSON object (pydantic models, sets, bytes, ...)."""
    dumped = ex.dump_model(value)
    if dumped is not value:
        return dumped
    if isinstance(value, (set, frozenset, tuple)):
        return list(value)
    if isinstance(value, (bytes, bytearray)):
        return f"[binary {len(value)} bytes]"
    return str(value)


def _encode(value: Any, *, ensure_ascii: bool) -> str:
    return json.dumps(value, ensure_ascii=ensure_ascii, separators=(",", ":"), default=json_default, allow_nan=False)


def dumps(value: Any) -> bytes:
    """Compact UTF-8 JSON that ``JSON.parse`` accepts: never ``NaN``/``Infinity``.

    Raises:
        ValueError, TypeError: only for values that have no JSON form even after
            :func:`finite` (the caller drops that one event, never the batch).
    """
    try:
        text = _encode(value, ensure_ascii=False)
    except (ValueError, TypeError):  # a non-finite number (or a cycle, or an odd key) somewhere
        value = finite(value)
        text = _encode(value, ensure_ascii=False)
    try:
        return text.encode("utf-8")
    except UnicodeEncodeError:  # lone surrogates (valid in JSON escapes, not in UTF-8)
        return _encode(value, ensure_ascii=True).encode("ascii")


def finite(value: Any, depth: int = 0, _stack: set[int] | None = None) -> Any:
    """A JSON-ready copy of ``value`` with ``NaN``/``Infinity`` as ``None``.

    Non-JSON objects go through :func:`json_default` first; cycles, nesting
    deeper than ``MAX_DEPTH`` and integers too long to print become ``None``;
    keys ``json`` cannot write become strings.
    """
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return value if _int_size(value) <= _MAX_INT_DIGITS else None
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    stack = _stack if _stack is not None else set()
    marker = id(value)
    if depth >= MAX_DEPTH or marker in stack:
        return None
    stack.add(marker)
    try:
        if isinstance(value, Mapping):
            return {_key(key): finite(item, depth + 1, stack) for key, item in value.items()}
        if isinstance(value, (list, tuple, set, frozenset)):
            return [finite(item, depth + 1, stack) for item in value]
        return finite(json_default(value), depth + 1, stack)
    finally:
        stack.discard(marker)


def _key(key: Any) -> Any:
    if key is None or isinstance(key, (str, bool, int)):
        return key
    if isinstance(key, float) and math.isfinite(key):
        return key
    return str(key)


# -- sizes -------------------------------------------------------------------


def json_size(value: Any) -> int:
    """The UTF-8 byte length of ``value`` as :func:`dumps` writes it, measured without writing it.

    Exact for ordinary messages. Strings longer than ``LONG_STRING`` characters
    and containers with more than ``WIDE_CONTAINER`` items are measured on evenly
    spaced samples and extrapolated, so a multi-megabyte response costs about
    as much to measure as a small one, and the measure runs as Python code that
    lets the server's threads run in between.
    """
    try:
        return _size(value, 0)
    except Exception:
        return 0


def _size(value: Any, depth: int) -> int:
    if value is None or value is True:
        return 4
    if value is False:
        return 5
    if isinstance(value, str):
        return _string_size(value)
    if isinstance(value, int):
        return _int_size(value)
    if isinstance(value, float):
        return len(repr(value)) if math.isfinite(value) else 4
    if depth >= MAX_DEPTH:
        return len(dumps(value))
    if isinstance(value, Mapping):
        return _container_size(list(value.items()) if len(value) > WIDE_CONTAINER else value.items(), depth, True)
    if isinstance(value, (list, tuple)):
        return _container_size(value, depth, False)
    return _size(json_default(value), depth + 1)


def _container_size(items: Any, depth: int, mapping: bool) -> int:
    count = len(items)
    if count == 0:
        return 2
    if count > WIDE_CONTAINER:
        sample = [items[i * count // CONTAINER_SAMPLES] for i in range(CONTAINER_SAMPLES)]
    else:
        sample = items
    if mapping:
        measured = sum(_key_size(key) + 1 + _size(item, depth + 1) for key, item in sample)
    else:
        measured = sum(_size(item, depth + 1) for item in sample)
    if count > WIDE_CONTAINER:
        measured = round(measured * count / CONTAINER_SAMPLES)
    return 2 + measured + count - 1


def _key_size(key: Any) -> int:
    if isinstance(key, str):
        return _string_size(key)
    if key is None or key is True:
        return 6
    if key is False:
        return 7
    if isinstance(key, int):
        return _int_size(key) + 2
    if isinstance(key, float):
        return len(repr(key)) + 2
    return _string_size(str(key))


def _int_size(value: int) -> int:
    try:
        return len(repr(value))
    except ValueError:  # beyond sys.get_int_max_str_digits()
        return int(value.bit_length() * 0.30103) + 1 + (value < 0)


def _string_size(value: str) -> int:
    length = len(value)
    if length <= LONG_STRING:
        return _exact_string_size(value)
    step = length // STRING_SAMPLES
    measured = sum(_exact_string_size(value[i * step : i * step + SAMPLE_CHARS]) - 2 for i in range(STRING_SAMPLES))
    return 2 + round(measured * length / (STRING_SAMPLES * SAMPLE_CHARS))


def _exact_string_size(value: str) -> int:
    quoted = encode_basestring(value)
    if value.isascii():
        return len(quoted)
    try:
        return len(quoted.encode("utf-8"))
    except UnicodeEncodeError:  # lone surrogates: dumps escapes them
        return len(encode_basestring_ascii(value))
