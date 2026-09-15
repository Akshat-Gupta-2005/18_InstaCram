"""Web Scraping Agent (W4 tasks 4a.1, 4a.1b, 4a.1c, 4a.1d).

Topic name -> grounding text + source URL, or an explicit refusal.

The refusal is the part that matters. The spike proved retrieval works and, in
the same run, proved retrieval is not the hard part: four Java topics came back
with one identical article because Wikipedia has no page for those classes. This
agent will NOT hand that text downstream, and nothing later would catch it - the
fact-check gate asks whether a claim is true, and generic prose about collections
is not false when the topic was TreeSet, merely not about it.

Two axes of fallback, cheapest first:

  WITHIN a source, several candidate titles. Direct title lookup finds
  "Availability heuristic" where search returns the broader "Heuristic"; search
  finds "Anchoring effect" where direct lookup returns "Anchor". Offering both is
  safe only because the relevance check rejects the wrong one.

  ACROSS sources, in order. Wikipedia covers concepts and has no page at all for
  Java library classes; Javadoc is the reverse. A topic is refused only when
  EVERY source fails.

See Docs/DECISIONS.md P26 and P27.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import asyncpg
import httpx

from app.config import MIN_USABLE_CHARS, SCRAPER_CONTACT, USER_AGENT
from app.relevance import classify
from app.repo.unsourced import mark_resolved, record_mismatch
from app.sources.base import Page, Source
from app.sources.javadoc import JavadocSource
from app.sources.wikipedia import WikipediaSource


@dataclass(frozen=True)
class Grounding:
    """What the agent hands to card generation, or why it will not."""

    topic: str
    field: str
    ok: bool
    reason: str
    text: str = ""
    source_url: str = ""
    source_name: str = ""
    matched_title: str | None = None

    @property
    def chars(self) -> int:
        return len(self.text)


@dataclass(frozen=True)
class Attempt:
    """One source's failure, and whether it is the TOPIC's fault.

    `kind is None` means the source was not able to answer for reasons that say
    nothing about the topic - a timeout, a robots.txt refusal. Recording those in
    unsourced_topic would blame the topic for a transport problem and poison the
    table used to decide which fields need another source.
    """

    source_name: str
    title: str | None
    kind: str | None
    chars: int | None
    reason: str


class ContactNotConfigured(RuntimeError):
    """Raised rather than defaulted. Wikimedia answers unidentified clients with
    HTTP 403; a fabricated contact would pass that check while defeating the
    policy it exists to satisfy."""


def build_client() -> httpx.AsyncClient:
    if not SCRAPER_CONTACT:
        raise ContactNotConfigured(
            "SCRAPER_CONTACT is not set. It must be a real URL or address a "
            "maintainer can be reached at, and it lives in the repo-root .env."
        )
    return httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, follow_redirects=True)


def default_sources(client: httpx.AsyncClient) -> list[Source]:
    """Wikipedia first: it is one request for a concept topic, and most topics are
    concepts. Javadoc is exact but only answers for classes it indexes, so it
    costs nothing to try second and catches precisely what Wikipedia cannot."""
    return [WikipediaSource(client), JavadocSource(client)]


async def ground_topic(
    topic: str,
    field: str,
    *,
    sources: Sequence[Source],
    conn: asyncpg.Connection | None = None,
) -> Grounding:
    attempts: list[Attempt] = []

    for source in sources:
        grounding, attempt = await _try_source(topic, field, source)
        if grounding is not None:
            # A topic that failed before and grounds now stops counting against
            # its field. Without this the table keeps reporting problems that a
            # newly added source already solved - stale, and still believed.
            if conn is not None:
                await mark_resolved(conn, topic=topic, resolved_by=source.name)
            return grounding
        attempts.append(attempt)

    # Only now is the topic genuinely unsourced. Recording per-source failures
    # while another source succeeded would turn "which fields need a different
    # source" into "how many sources were tried", which answers nothing.
    for attempt in attempts:
        if attempt.kind is None:
            continue
        await _record(conn, topic, field, attempt)

    detail = "; ".join(f"{a.source_name}: {a.reason}" for a in attempts) or "no sources configured"
    return Grounding(topic, field, False, detail)


async def _try_source(
    topic: str, field: str, source: Source
) -> tuple[Grounding | None, Attempt]:
    titles = await source.candidates(topic, field)
    if not titles:
        return None, Attempt(
            source.name, None, "no_article", None, "no entry for this topic"
        )

    fetched: dict[str, Page | None] = {}

    async def get(title: str) -> Page | None:
        if title not in fetched:
            fetched[title] = await source.fetch(title)
        return fetched[title]

    thin: str | None = None

    for title in titles:
        if not classify(topic, title).usable:
            continue
        page = await get(title)
        if page is None:
            continue  # unreadable; a later candidate may still work
        if len(page.text) >= MIN_USABLE_CHARS:
            return _accept(topic, field, source.name, page, classify(topic, page.title).reason), _unused(source)
        thin = f"the right page ({page.title!r}) but only {len(page.text)} chars"

    # Task 4a.1d: no candidate was the topic, but the best guess may contain a
    # SECTION that is. That is the difference between grounding TreeSet on its
    # own section and on 22,789 chars about the whole framework.
    best = titles[0]
    page = await get(best)
    if page is None:
        return None, Attempt(
            source.name, best, None, None,
            f"could not retrieve {best!r} - the fetch failed, robots.txt disallowed "
            "it, or the page returned was not the expected content",
        )

    part = await source.section(page, topic)
    if part is not None:
        verdict = classify(topic, page.title)
        return _accept(
            topic, field, source.name, part,
            f"{verdict.reason}; used the matching section instead of the whole page",
        ), _unused(source)

    if thin is not None:
        return None, Attempt(source.name, page.title, None, len(page.text), thin)

    verdict = classify(topic, page.title)
    reason = f"{verdict.reason}; no section of it is about the topic either"
    return None, Attempt(
        source.name, page.title, verdict.mismatch_kind or "generic", len(page.text), reason
    )


def _unused(source: Source) -> Attempt:
    """Placeholder for the success path, where no failure is recorded."""
    return Attempt(source.name, None, None, None, "")


def _accept(
    topic: str, field: str, source_name: str, page: Page, reason: str
) -> Grounding:
    return Grounding(
        topic, field, True, reason,
        text=page.text, source_url=page.url,
        source_name=source_name, matched_title=page.title,
    )


async def _record(
    conn: asyncpg.Connection | None, topic: str, field: str, attempt: Attempt
) -> None:
    """Recording is optional so the agent stays runnable standalone, which is what
    task 4a.1 asks for. Without a connection the refusal still happens; only the
    durable record is skipped."""
    if conn is None or attempt.kind is None:
        return
    await record_mismatch(
        conn, topic=topic, field=field, source=attempt.source_name,
        matched_title=attempt.title, kind=attempt.kind,
        chars=attempt.chars, note=attempt.reason,
    )
