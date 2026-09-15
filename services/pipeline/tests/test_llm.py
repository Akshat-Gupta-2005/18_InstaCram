"""JSON extraction repairs, against the shapes models actually produce.

These are not hypothetical. The first calibration run lost 2 of 8 fields to
"Bad control character in string literal" and "Expected ':' after property name",
which is why decoding is constrained AND parsing is forgiving (P24).
"""

from __future__ import annotations

import pytest

from app.llm import LLMError, extract_json


def test_plain_json() -> None:
    assert extract_json('{"verdict": "pass"}') == {"verdict": "pass"}


def test_fenced_json() -> None:
    assert extract_json('```json\n{"verdict": "pass"}\n```') == {"verdict": "pass"}


def test_fenced_without_language() -> None:
    assert extract_json('```\n{"a": 1}\n```') == {"a": 1}


def test_leading_prose_is_survivable() -> None:
    raw = 'Sure! Here is the JSON you asked for:\n{"a": 1}'
    assert extract_json(raw) == {"a": 1}


def test_literal_newline_inside_a_string_is_repaired() -> None:
    """The single most common way otherwise-fine model JSON fails to parse."""
    raw = '{"content": "line one\nline two"}'
    assert extract_json(raw)["content"] == "line one\nline two"


def test_literal_tab_inside_a_string_is_repaired() -> None:
    assert extract_json('{"content": "a\tb"}')["content"] == "a\tb"


def test_escaped_newline_is_left_alone() -> None:
    """The repair must not double-escape text that was already valid."""
    assert extract_json(r'{"content": "line\none"}')["content"] == "line\none"


def test_newlines_between_fields_still_work() -> None:
    assert extract_json('{\n  "a": 1,\n  "b": 2\n}') == {"a": 1, "b": 2}


def test_unusable_output_raises_rather_than_returning_none() -> None:
    with pytest.raises(LLMError, match="did not return usable JSON"):
        extract_json("I'm sorry, I can't help with that.")
