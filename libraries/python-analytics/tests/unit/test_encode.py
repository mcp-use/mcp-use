from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

import pytest

from mcp_use_analytics._encode import LONG_STRING, WIDE_CONTAINER, dumps, json_size


class Model:
    def model_dump(self, **_: Any) -> dict[str, Any]:
        return {"type": "text", "text": "from a model", "n": 3}


@dataclass
class Point:
    x: int


ORDINARY = [
    None,
    True,
    False,
    0,
    -12,
    2**70,
    3.5,
    -1e300,
    1e-7,
    "",
    "plain",
    'quote " back \\ slash /',
    "tab\t nl\n cr\r ctrl\x01\x1f del\x7f",
    "é ü 中文 😀",
    "x" * LONG_STRING,
    {"a": [1, 2.5, None, True], "b": {"c": "d"}},
    {5: "int key", 1.5: "float key", None: "none key", True: "bool key", False: "false key"},
    [[], {}, [[]], [{}]],
    ("tuple", 1),
    {"jsonrpc": "2.0", "id": 7, "result": {"content": [{"type": "text", "text": "ok"}], "isError": False}},
    [Model(), b"raw bytes", Point(1)],
    list(range(WIDE_CONTAINER)),
    {f"k{i}": i for i in range(WIDE_CONTAINER)},
    float("inf"),
    {"n": float("nan")},
]


@pytest.mark.parametrize("value", ORDINARY, ids=lambda value: type(value).__name__)
def test_json_size_is_exact_for_ordinary_messages(value: Any) -> None:
    assert json_size(value) == len(dumps(value))


@pytest.mark.parametrize(
    "value",
    [
        "a" * 200_000,
        "é" * 100_001,
        ("line\n" + "x" * 70) * 5_000,
        [{"id": i, "name": f"item-{i}", "tags": ["a", "b"]} for i in range(20_000)],
        {f"key-{i}": {"value": i * 1.5} for i in range(5_000)},
    ],
    ids=["ascii", "unicode", "escapes", "wide-list", "wide-dict"],
)
def test_json_size_estimates_large_values_closely(value: Any) -> None:
    exact = len(dumps(value))
    assert abs(json_size(value) - exact) <= exact * 0.01, (json_size(value), exact)


def test_json_size_is_cheap_for_huge_values() -> None:
    value = {"content": [{"type": "text", "text": "x" * 20_000_000}], "items": list(range(1_000_000))}
    started = time.perf_counter()
    json_size(value)
    assert time.perf_counter() - started < 0.05


def test_huge_ints_and_failures_never_raise() -> None:
    class Broken:
        def model_dump(self, **_: Any) -> Any:
            raise RuntimeError("bug")

        def __str__(self) -> str:
            raise RuntimeError("bug")

    assert json_size(10**5000) > 4000
    assert json_size(Broken()) >= 0


def test_dumps_is_strict_json() -> None:
    def reject(token: str) -> Any:
        raise ValueError(token)

    cycle: list[Any] = [1]
    cycle.append(cycle)
    value = {"inf": float("inf"), "cycle": cycle, (1, 2): "tuple key", "huge": 10**5000, "int": 10**20}
    out = json.loads(dumps(value), parse_constant=reject)
    assert out == {"inf": None, "cycle": [1, None], "(1, 2)": "tuple key", "huge": None, "int": 10**20}
    assert dumps("\ud800") == b'"\\ud800"'  # a lone surrogate is escaped, never invalid UTF-8
