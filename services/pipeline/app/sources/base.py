"""What a grounding source has to be able to do.

Two sources exist: an encyclopedia, which covers concepts well and library APIs
not at all, and official API documentation, which is the reverse. The protocol
keeps the first source's quirks from leaking into the agent.

WHY `candidates` AND NOT `find`: discovery is a guess, and different guesses fail
on different topics. Direct title lookup finds "Availability heuristic" where
search returns the broader "Heuristic"; search finds "Anchoring effect" where
direct lookup returns "Anchor", the nautical one. Neither strategy wins.

Returning several candidates is only safe BECAUSE the relevance check exists to
reject the wrong ones - before it, more guesses meant more ways to ground a card
on the wrong article. See Docs/DECISIONS.md P26 and P27.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Page:
    """One retrieved page. `title` is what the source actually returned, which is
    not necessarily what was asked for - that gap is the whole point of the
    relevance check."""

    title: str
    text: str
    url: str


class Source(Protocol):
    name: str

    async def candidates(self, topic: str, field: str) -> list[str]:
        """Titles that might be this topic, best guess first.

        Empty when the source has nothing. Callers must run each through the
        relevance check before fetching: these are guesses, not answers.
        """

    async def fetch(self, title: str) -> Page | None:
        """Full plain-text page, or None when it cannot be retrieved."""

    async def section(self, page: Page, topic: str) -> Page | None:
        """The part of `page` that is about `topic`, when the page covers several
        topics and one of its sections is the topic's. None when no section
        matches, which is the signal to fall back to recording a mismatch."""
