"""The relevance check, against the cases that were actually measured.

Every topic/title pair below came from a real scraper run on 2026-09-15, not from
imagination. That matters: the bug this module exists to catch was invisible to a
character-count metric, so the tests are written against observed behaviour
rather than against what the rule was supposed to do.
"""

from __future__ import annotations

import pytest

from app.relevance import classify, tokens

# Measured mismatches: the article came back, and it was not about the topic.
MEASURED_MISMATCHES = [
    ("TreeSet", "Java collections framework"),
    ("ArrayList", "Java collections framework"),
    ("LinkedHashMap", "Java collections framework"),
    ("ConcurrentSkipListMap", "Java collections framework"),
    ("HashMap", "Hash table"),
    ("Availability heuristic", "Heuristic"),
]

# Measured good matches from the same run.
MEASURED_MATCHES = [
    ("Loss aversion", "Loss aversion"),
    ("Hyperbolic discounting", "Hyperbolic discounting"),
    ("Endowment effect", "Endowment effect"),
    ("Anchoring", "Anchoring effect"),
]


@pytest.mark.parametrize(("topic", "title"), MEASURED_MISMATCHES)
def test_measured_mismatches_are_rejected(topic: str, title: str) -> None:
    """The six pairs that would have grounded cards on the wrong article."""
    result = classify(topic, title)
    assert not result.usable, f"{topic!r} vs {title!r} should not be usable"
    assert result.mismatch_kind == "generic"


@pytest.mark.parametrize(("topic", "title"), MEASURED_MATCHES)
def test_measured_matches_are_accepted(topic: str, title: str) -> None:
    result = classify(topic, title)
    assert result.usable, f"{topic!r} vs {title!r} should be usable: {result.reason}"


def test_four_java_topics_all_rejected_against_the_same_article() -> None:
    """The headline failure: four distinct topics, one identical 22,789-char page.

    Asserted as a group rather than only one by one, because the thing that made
    it a bug was that it happened FOUR times and still scored 10/10.
    """
    shared = "Java collections framework"
    topics = ["TreeSet", "ArrayList", "LinkedHashMap", "ConcurrentSkipListMap"]
    assert all(not classify(t, shared).usable for t in topics)


def test_direction_matters_not_just_overlap() -> None:
    """A broader article and a more specific one share words either way. Only the
    direction of containment separates them, which is the whole rule."""
    assert classify("Anchoring", "Anchoring effect").verdict == "specific"
    assert classify("Availability heuristic", "Heuristic").verdict == "broader"


def test_exact_match_is_exact() -> None:
    assert classify("Loss aversion", "Loss aversion").verdict == "exact"


def test_camel_case_topic_matches_a_spaced_title() -> None:
    """'HashMap' and 'Hash map' are the same name written two ways."""
    assert classify("HashMap", "Hash map").usable


def test_wikipedia_disambiguator_is_ignored() -> None:
    """Titles like 'Set (abstract data type)' carry a parenthetical that is about
    the title, not about the concept."""
    assert classify("Set", "Set (abstract data type)").usable


def test_empty_input_is_not_usable() -> None:
    assert not classify("", "Hash table").usable
    assert not classify("HashMap", "").usable


def test_tokens_drops_noise_words() -> None:
    assert tokens("The Java Collections Framework") == tokens("Java Collections")


# --- regression: the sibling-section bug, found on the agent's first real run ---
#
# Containment accepted these, so HashMap was grounded on the LinkedHashMap
# section of a shared article and ArrayList on CopyOnWriteArrayList. Sections of
# one article are confusable PEERS, not a hierarchy: a longer sibling name means
# a different class, not a more specific version of the same one.

SIBLING_TRAPS = [
    ("HashMap", "LinkedHashMap"),
    ("HashMap", "ConcurrentHashMap"),
    ("ArrayList", "CopyOnWriteArrayList class"),
    ("Set", "TreeSet"),
    ("Map", "LinkedHashMap"),
]


@pytest.mark.parametrize(("topic", "heading"), SIBLING_TRAPS)
def test_sibling_headings_are_rejected(topic: str, heading: str) -> None:
    assert not classify(topic, heading, siblings=True).usable


@pytest.mark.parametrize(("topic", "heading"), SIBLING_TRAPS)
def test_containment_alone_would_have_accepted_them(topic: str, heading: str) -> None:
    """Proves the strict mode is doing the work, rather than the pair being easy.

    Without this, the tests above would still pass if the token rule happened to
    reject these for some unrelated reason, and the real fix could be removed
    without anything failing.
    """
    assert classify(topic, heading).usable


def test_a_sibling_heading_that_IS_the_topic_still_matches() -> None:
    """The strict rule must not reject the case section extraction exists for."""
    assert classify("LinkedHashMap", "LinkedHashMap").usable
    assert classify("TreeSet", "TreeSet class").usable


def test_noise_words_do_not_make_a_sibling_look_exact() -> None:
    """'class' is dropped as noise, which is what lets 'TreeSet class' match -
    it must not also let a different class through."""
    assert not classify("ArrayList", "CopyOnWriteArrayList class", siblings=True).usable


@pytest.mark.xfail(
    reason="Known limitation, recorded rather than papered over: an abbreviation "
    "shares no tokens with its expansion. Fixing it needs an embedding check, "
    "which would add a second uncalibrated threshold (P4).",
    strict=True,
)
def test_abbreviation_expansion_is_not_handled() -> None:
    assert classify("BFS", "Breadth-first search").usable
