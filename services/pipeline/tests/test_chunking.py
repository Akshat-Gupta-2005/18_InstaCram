"""The splitter that keeps a prompt inside the context window.

The properties here are the ones whose violation is SILENT downstream: a chunk
over budget overflows the window and the model answers anyway (P33), and a gap
between chunks hides a contradiction that the gate then reports as absent.
"""

from __future__ import annotations

import pytest

from app.chunking import split


def test_short_text_is_one_chunk() -> None:
    """The common case - a Javadoc class description - must cost exactly one
    call and behave as it did before chunking existed."""
    assert split("a short page", size=1000) == ["a short page"]


def test_empty_text_yields_no_chunks() -> None:
    assert split("", size=100) == []
    assert split("   \n  ", size=100) == []


def test_no_chunk_exceeds_the_budget() -> None:
    text = "word " * 5000
    for chunk in split(text, size=500, overlap=50):
        assert len(chunk) <= 500


def test_every_chunk_is_within_budget_even_with_no_separators() -> None:
    """A single unbroken run of text has nothing to break on. The fallback must
    still respect the budget rather than emit one oversized chunk."""
    text = "x" * 5000
    chunks = split(text, size=400, overlap=40)
    assert chunks
    for chunk in chunks:
        assert len(chunk) <= 400


def test_the_whole_text_is_covered() -> None:
    """Concatenating the chunks must reproduce every character of the source.
    A dropped span is a span the fact-checker never reads, which is the exact
    failure chunking exists to prevent."""
    text = "\n\n".join(f"Paragraph {i} says something specific." for i in range(200))
    joined = "".join(split(text, size=300, overlap=0))
    assert joined.replace("\n", "").replace(" ", "") == text.replace("\n", "").replace(" ", "")


def test_overlap_makes_a_boundary_spanning_claim_whole_somewhere() -> None:
    """A claim split across two chunks is half-present in both and whole in
    neither, so no chunk can contradict it. Overlap is what prevents that."""
    claim = "the coefficient is approximately two point two five"
    filler = "padding text. " * 60
    text = filler + claim + filler

    chunks = split(text, size=400, overlap=len(claim) + 20)
    assert any(claim in chunk for chunk in chunks), "no chunk contains the whole claim"


def test_breaks_prefer_paragraph_boundaries() -> None:
    text = ("A" * 180) + "\n\n" + ("B" * 180) + "\n\n" + ("C" * 180)
    chunks = split(text, size=200, overlap=0)
    # The first chunk should stop at the paragraph break, not mid-run.
    assert chunks[0] == "A" * 180


def test_progress_is_guaranteed_with_a_large_overlap() -> None:
    """A big overlap must not walk the cursor backwards. This terminating is the
    assertion - the test hanging is the failure."""
    chunks = split("sentence. " * 500, size=200, overlap=199)
    assert len(chunks) < 500


def test_overlap_at_least_the_size_is_rejected() -> None:
    with pytest.raises(ValueError, match="smaller than size"):
        split("text", size=100, overlap=100)


def test_nonpositive_size_is_rejected() -> None:
    with pytest.raises(ValueError, match="positive"):
        split("text", size=0)
