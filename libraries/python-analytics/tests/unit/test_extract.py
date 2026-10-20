from __future__ import annotations

import pytest

from mcp_use_analytics._extract import clip, cut, error_message, tool_error_text

SMILE = "\U0001f600"  # two UTF-16 code units


def units(text: str) -> int:
    return len(text.encode("utf-16-le", "surrogatepass")) // 2


@pytest.mark.parametrize(
    ("text", "limit", "expected"),
    [
        ("abc", 3, "abc"),
        ("abcd", 3, "abc"),
        ("", 5, ""),
        (SMILE, 2, SMILE),
        (SMILE, 1, ""),  # never half of the pair
        ("ab" + SMILE, 3, "ab"),
        ("ab" + SMILE, 4, "ab" + SMILE),
        ("ab" + SMILE + "c", 4, "ab" + SMILE),
        (SMILE * 3, 5, SMILE * 2),
        (SMILE * 3, 6, SMILE * 3),
        ("é" * 10, 4, "é" * 4),  # one code unit each
        ("\ud83d" + "x", 1, ""),  # a lone first half at the cut goes too, as in JavaScript
        ("x\ude00y", 2, "x\ude00"),  # a lone second half counts as one unit
    ],
)
def test_cut_counts_utf16_code_units_like_javascript(text: str, limit: int, expected: str) -> None:
    result = cut(text, limit)
    assert result == expected
    assert units(result) <= limit


def test_cut_long_values_never_exceed_the_limit() -> None:
    for prefix in range(6):
        text = "x" * prefix + SMILE * 3000
        result = cut(text, 4096)
        assert units(result) in (4095, 4096)
        assert text.startswith(result)
        assert not result or not ("\ud800" <= result[-1] <= "\udbff")


def test_clip_strips_and_returns_none_for_nothing_left() -> None:
    assert clip(f"  {SMILE}x  ", 3) == f"{SMILE}x"
    assert clip(SMILE, 1) is None
    assert clip("   ", 5) is None
    assert clip(None, 5) is None
    assert clip(42, 5) == "42"


def test_error_messages_are_cut_at_500_code_units() -> None:
    long = "x" * 499 + SMILE + "tail"
    assert error_message(long) == "x" * 499
    assert tool_error_text({"content": [{"type": "text", "text": long}]}) == "x" * 499
