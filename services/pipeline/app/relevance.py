"""Is the article we got back actually about the topic we asked for?

WHY THIS EXISTS: the scraper spike reported 10/10 usable while four Java topics
were grounded on one identical article, because its success test was "more than
500 characters" - and a wrong article is exactly as long as a right one. Nothing
downstream catches it either: the fact-check gate asks whether a claim is TRUE,
and generic text about collections is not false when the topic was TreeSet. It
is merely not about TreeSet. See Docs/DECISIONS.md P26.

THE RULE IS DIRECTIONAL CONTAINMENT, which is what the measured failures
actually look like:

    topic "Anchoring"              title "Anchoring effect"           KEEP
        topic tokens are a subset of the title's, so the article is at
        least as specific as the topic.

    topic "Availability heuristic" title "Heuristic"                  BROADER
        the TITLE is the subset. The article is about a larger category
        that merely contains the topic.

    topic "TreeSet"                title "Java collections framework"  UNRELATED
        neither contains the other.

This is deliberately deterministic - no model call, no threshold. An embedding
similarity check would handle abbreviations better ("BFS" vs "Breadth-first
search"), but it would introduce a SECOND uncalibrated threshold, and this
project's rule is that a threshold is measured before it is trusted (P4). The
abbreviation gap is recorded as a known limitation instead of being papered over
with a number nobody measured.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Verdict = Literal["exact", "specific", "broader", "unrelated"]

# Wikipedia titles carry disambiguators like "Set (abstract data type)". They are
# information about the title, not part of the concept name.
_PARENTHETICAL = re.compile(r"\([^)]*\)")

# "HashMap" -> "Hash Map", so a compound topic name can match a spaced title.
_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")

_NON_WORD = re.compile(r"[^a-z0-9\s]+")

# Words that carry no concept meaning in a title or heading and would otherwise
# block a match ("Java collections framework" vs "Java collections", or the
# section heading "CopyOnWriteArrayList class" vs the class itself).
_NOISE = frozenset(
    {
        "the", "a", "an", "of", "in", "and",
        "framework", "overview", "class", "classes", "interface", "interfaces",
        "implementation", "implementations",
    }
)


def tokens(text: str) -> frozenset[str]:
    """Normalise a topic name or an article title to a comparable token set."""
    text = _PARENTHETICAL.sub(" ", text)
    text = _CAMEL_BOUNDARY.sub(" ", text)
    text = _NON_WORD.sub(" ", text.lower())
    return frozenset(t for t in text.split() if t and t not in _NOISE)


@dataclass(frozen=True)
class Relevance:
    verdict: Verdict
    reason: str

    @property
    def usable(self) -> bool:
        """Only an exact or more-specific article may ground a card.

        'broader' is excluded on purpose even though its text is perfectly good
        prose: grounding four different topics on one framework overview is the
        failure this module exists to stop.
        """
        return self.verdict in ("exact", "specific")

    @property
    def mismatch_kind(self) -> str | None:
        """How this gets recorded in unsourced_topic, or None when usable.

        Both non-usable verdicts record as 'generic', because in each case a page
        DID come back and it was about something broader or different. The other
        kind, 'no_article', is reserved for a search that returned nothing at all
        - the caller reports that, since this function never sees it.
        """
        return None if self.usable else "generic"


def classify(topic: str, title: str, *, siblings: bool = False) -> Relevance:
    """Compare a topic against what came back.

    `siblings=True` demands an EXACT token match, and exists because of a bug
    this rule caused on its first real run: asked for `HashMap`, it accepted the
    `LinkedHashMap` section of a shared article, because {hash, map} is a subset
    of {linked, hash, map}. It also grounded `ArrayList` on
    `CopyOnWriteArrayList`.

    Containment is right for a searched TITLE - "Anchoring" really is the topic
    of "Anchoring effect" - but wrong for section headings inside one article,
    because those are a set of sibling classes where a longer name means a
    DIFFERENT class, not a more specific version of the same one. A searched
    title is a best guess at the topic's own page; a sibling heading is one peer
    among confusable peers, so it gets the stricter test. Biasing toward
    rejection is the same asymmetry as P4: a false accept silently grounds a card
    on the wrong thing, a false reject only costs a regeneration.
    """
    topic_t = tokens(topic)
    title_t = tokens(title)

    if not topic_t or not title_t:
        return Relevance("unrelated", "topic or title had no comparable words")

    if topic_t == title_t:
        return Relevance("exact", f"title matches the topic: {title!r}")

    if siblings:
        return Relevance(
            "unrelated",
            f"{title!r} is a sibling of {topic!r}, not the topic itself",
        )

    if topic_t <= title_t:
        return Relevance(
            "specific",
            f"the article {title!r} is at least as specific as the topic",
        )

    if title_t <= topic_t:
        return Relevance(
            "broader",
            f"the article {title!r} is a broader category than {topic!r}; "
            "grounding on it would produce generic text",
        )

    return Relevance(
        "unrelated",
        f"the article {title!r} shares no containing relationship with {topic!r}",
    )
