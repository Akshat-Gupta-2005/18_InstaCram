"""Draft validation - the last check before a card reaches the database.

The schema is the backstop (source_url NOT NULL, trust_label CHECK), but a card
rejected by Postgres arrives as a constraint violation naming a column, when the
quarantine needs a reason a human can read.
"""

from __future__ import annotations

from app.agents.card_gen import Draft, Rejected, SourceText, _validate, format_sources

ALLOWED = frozenset({"https://en.wikipedia.org/wiki/Hash_table"})

GOOD = {
    "content": "A hash table maps keys to buckets using a hash function.",
    "source_url": "https://en.wikipedia.org/wiki/Hash_table",
    "trust_label": "sourced_verified",
    "why_it_matters": "It explains why lookup is constant time until it isn't.",
    "recall_prompt": "What causes a hash table lookup to degrade?",
    "recall_answer": "Collisions concentrating many keys into one bucket.",
}


def test_a_complete_draft_is_accepted() -> None:
    assert isinstance(_validate(GOOD, ALLOWED), Draft)


def test_every_required_field_is_required() -> None:
    for field in GOOD:
        draft = dict(GOOD) | {field: "  "}
        result = _validate(draft, ALLOWED)
        assert isinstance(result, Rejected), f"{field} should be required"
        assert field in result.reason


def test_invalid_trust_label_is_rejected() -> None:
    result = _validate(dict(GOOD) | {"trust_label": "verified"}, ALLOWED)
    assert isinstance(result, Rejected)
    assert "trust_label" in result.reason


def test_both_valid_trust_labels_are_accepted() -> None:
    for label in ("sourced_verified", "ai_generated"):
        assert isinstance(_validate(dict(GOOD) | {"trust_label": label}, ALLOWED), Draft)


def test_a_hallucinated_source_url_is_rejected() -> None:
    """Invariant 4 says a card with no provenance must not be servable. A URL the
    generator invented is worse than none: it LOOKS like provenance, and that
    link is the user's only way to check a fact."""
    result = _validate(
        dict(GOOD) | {"source_url": "https://en.wikipedia.org/wiki/Invented"}, ALLOWED
    )
    assert isinstance(result, Rejected)
    assert "not among the URLs supplied" in result.reason


def test_a_non_object_draft_is_rejected_not_crashed() -> None:
    assert isinstance(_validate("a string", ALLOWED), Rejected)
    assert isinstance(_validate(None, ALLOWED), Rejected)


def test_format_sources_labels_each_block_with_its_url() -> None:
    out = format_sources([SourceText("body text", "https://example.com/a")])
    assert "https://example.com/a" in out
    assert "body text" in out


def test_format_sources_truncates_and_says_so() -> None:
    out = format_sources([SourceText("x" * 50_000, "https://example.com/a")])
    assert "[...truncated]" in out
    assert len(out) < 10_000


def test_format_sources_handles_no_sources() -> None:
    assert format_sources([]) == "(none)"
