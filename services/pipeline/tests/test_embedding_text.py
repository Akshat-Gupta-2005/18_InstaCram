"""Pins the embedded-text format against the serving service's version.

This is a contract with one implementation per language. If the two disagree by
a single character, every topic lookup misses, every topic regenerates as a
duplicate, and NOTHING ERRORS - the cache silently stops working while reporting
perfect health. That is worse than a crash, so the format is asserted literally
here rather than trusted to two authors agreeing.

The authority is services/serving/src/topics/embeddingText.ts:
    return `${prefix}${name}: ${description}`;
"""

from __future__ import annotations

import pytest

from app.embedding_text import topic_embedding_text


@pytest.fixture(autouse=True)
def no_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EMBEDDING_TEXT_PREFIX", raising=False)


def test_exact_format_is_name_colon_space_description() -> None:
    assert topic_embedding_text("HashMap", "A hash-table map") == "HashMap: A hash-table map"


def test_no_prefix_by_default() -> None:
    """Empty on purpose: e5's documented 'query: ' prefix was MEASURED and made
    reuse worse (53% vs 67%), so the convention was tested and then not used."""
    assert not topic_embedding_text("X", "y").startswith("query:")


def test_prefix_is_applied_when_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMBEDDING_TEXT_PREFIX", "query: ")
    assert topic_embedding_text("HashMap", "A map") == "query: HashMap: A map"


def test_nothing_is_trimmed_or_normalised() -> None:
    """The serving version does no trimming either. Adding any here would be an
    invisible divergence - it would only show up as a cache that never hits."""
    assert topic_embedding_text(" Spaced ", " desc ") == " Spaced :  desc "


def test_description_is_included_not_just_the_name() -> None:
    """Name-only would be catastrophic for P4: two bare 'Stack' strings embed
    IDENTICALLY, so no threshold could ever separate them."""
    a = topic_embedding_text("Stack", "a LIFO data structure")
    b = topic_embedding_text("Stack", "the set of technologies used to build an app")
    assert a != b
