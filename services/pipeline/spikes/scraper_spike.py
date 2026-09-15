"""Scraper viability spike - throwaway, not shipped code.

THE QUESTION: can we actually retrieve usable grounding material for real topics,
and by what route? The pipeline design says the scraper turns a topic name into
"snippets + source URLs" but never says how it FINDS those URLs. That discovery
step is the real unknown, and it is buried inside W4 where it would surface late.

This runs the cheapest route first - plain HTTP against a documented API - because
if that works, a browser is not needed for these sources at all. A browser is only
required for pages that render their content with JavaScript, and finding out we
do not need one is itself a useful result.

It also checks robots.txt for every host it touches, which closes a standing open
item about robots/terms-of-service handling.

Run:  .venv/Scripts/python spikes/scraper_spike.py
"""

from __future__ import annotations

import os
import statistics
import sys
import time
import urllib.robotparser
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlparse

import httpx
from dotenv import load_dotenv

# The ONE .env lives at the repo root. This script runs with services/pipeline as
# its working directory, so a bare load_dotenv() would look in the wrong place and
# silently find nothing - leaving SCRAPER_CONTACT empty and every request a 403.
load_dotenv(Path(__file__).resolve().parents[3] / ".env")

# A real mix: well-documented technical topics, and non-technical ones, because
# the product claims to work for both and the second kind is where sourcing is
# likely to be thinner.
TOPICS: list[tuple[str, str]] = [
    ("Java Collections", "HashMap"),
    ("Java Collections", "TreeSet"),
    ("Java Collections", "ArrayList"),
    ("Java Collections", "ConcurrentSkipListMap"),
    ("Java Collections", "LinkedHashMap"),
    ("Behavioural Economics", "Anchoring"),
    ("Behavioural Economics", "Loss aversion"),
    ("Behavioural Economics", "Hyperbolic discounting"),
    ("Behavioural Economics", "Endowment effect"),
    ("Behavioural Economics", "Availability heuristic"),
]

USABLE_CHARS = 500  # below this there is not enough to ground a card

# Wikimedia rejects clients that do not identify themselves: an earlier run got
# HTTP 403 with "Please respect our robot policy when crawling us" on every
# request, while the same URL from a browser-style client returned 200. The
# compliant answer is a User-Agent carrying a REAL contact, so it is read from the
# environment and never committed. Disguising the client to get past the check
# would be evading a policy rather than following it.
CONTACT = os.environ.get("SCRAPER_CONTACT", "").strip()
USER_AGENT = f"InstaCram/0.1 (scraper evaluation; {CONTACT})"


@dataclass
class Result:
    field: str
    topic: str
    ok: bool
    chars: int
    url: str
    note: str
    seconds: float


def describe_response(resp: httpx.Response) -> str:
    """Non-JSON responses are the interesting failure, so say what arrived
    instead of only that parsing failed."""
    ctype = resp.headers.get("content-type", "?").split(";")[0]
    return f"HTTP {resp.status_code} {ctype} {resp.text[:80]!r}"


def robots_allows(client: httpx.Client, url: str) -> bool:
    """Ask the host's robots.txt before fetching. Cheap, and it is the line
    between 'automated reading' and 'ignoring what the site asked for'."""
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    parser = urllib.robotparser.RobotFileParser()
    try:
        resp = client.get(robots_url, timeout=15)
        parser.parse(resp.text.splitlines())
    except httpx.HTTPError:
        return True  # no robots.txt reachable = nothing disallowed
    return parser.can_fetch(USER_AGENT, url)


def fetch_topic(client: httpx.Client, field: str, topic: str) -> Result:
    started = time.monotonic()

    # Step 1: discovery. Search for the topic, biased by its field so that
    # "Stack" in one field cannot silently return the other field's article.
    search_url = (
        "https://en.wikipedia.org/w/api.php"
        f"?action=query&list=search&srsearch={quote(f'{topic} {field}')}"
        "&srlimit=1&format=json"
    )
    try:
        resp = client.get(search_url, timeout=30)
    except httpx.HTTPError as exc:
        return Result(field, topic, False, 0, "", f"search request failed: {type(exc).__name__}: {exc}", time.monotonic() - started)

    try:
        hits = resp.json().get("query", {}).get("search", [])
    except ValueError:
        return Result(field, topic, False, 0, "", f"search returned non-JSON: {describe_response(resp)}", time.monotonic() - started)

    if not hits:
        return Result(field, topic, False, 0, "", "no search hit", time.monotonic() - started)
    title = str(hits[0].get("title", "")).strip()
    if not title:
        return Result(field, topic, False, 0, "", "search hit had no title", time.monotonic() - started)

    # Step 2: retrieval. Plain text extract, no HTML parsing, no browser.
    page_url = f"https://en.wikipedia.org/wiki/{quote(title.replace(' ', '_'))}"
    if not robots_allows(client, page_url):
        return Result(field, topic, False, 0, page_url, "robots.txt disallows", time.monotonic() - started)

    extract_url = (
        "https://en.wikipedia.org/w/api.php"
        f"?action=query&prop=extracts&explaintext=1&titles={quote(title)}&format=json"
    )
    try:
        resp = client.get(extract_url, timeout=30)
        pages = resp.json().get("query", {}).get("pages", {})
        text = next(iter(pages.values()), {}).get("extract", "")
    except httpx.HTTPError as exc:
        return Result(field, topic, False, 0, page_url, f"extract request failed: {exc}", time.monotonic() - started)
    except ValueError:
        return Result(field, topic, False, 0, page_url, f"extract returned non-JSON: {describe_response(resp)}", time.monotonic() - started)

    elapsed = time.monotonic() - started
    ok = len(text) >= USABLE_CHARS
    note = f"matched '{title}'" if ok else f"matched '{title}' but only {len(text)} chars"
    return Result(field, topic, ok, len(text), page_url, note, elapsed)


def verdict(results: list[Result]) -> str:
    """Derived from what actually happened. An earlier version printed a fixed
    conclusion, which meant it reported success after every fetch had failed -
    exactly the kind of result-independent claim a spike exists to avoid."""
    usable = [r for r in results if r.ok]
    share = len(usable) / len(results) if results else 0

    if share == 0:
        reasons = Counter(r.note.split(":")[0] for r in results).most_common(1)
        dominant = reasons[0][0] if reasons else "unknown"
        return (
            f"VERDICT: NOT VIABLE by this route - 0/{len(results)} topics returned usable text.\n"
            f"Dominant failure: {dominant}. Fix or replace the discovery route before W4\n"
            "depends on it; the scraper is the only non-LLM agent, so there is no prompt\n"
            "to tune around a source that will not answer."
        )
    if share < 0.8:
        return (
            f"VERDICT: PARTIAL - {len(usable)}/{len(results)} topics returned usable text.\n"
            "Good enough to prove the route works, not good enough to rely on alone.\n"
            "A second source is needed before W4, and the card generator must cope with\n"
            "topics that have thin grounding."
        )
    return (
        f"VERDICT: VIABLE - {len(usable)}/{len(results)} topics returned usable text with plain\n"
        "HTTP and no browser. Wikipedia's licence requires attribution, which the design\n"
        "already provides through source_url. A second, non-Wikipedia route is still worth\n"
        "testing so the pipeline does not rest on a single source."
    )


def main() -> int:
    if not CONTACT:
        print(
            "SCRAPER_CONTACT is not set.\n\n"
            "Wikimedia requires a User-Agent identifying the client with real contact\n"
            "details, and returns HTTP 403 without one. Set it to a project URL or an\n"
            "email address you are happy to appear in their logs, for example:\n\n"
            '    $env:SCRAPER_CONTACT = "https://github.com/you/instacram"\n',
            file=sys.stderr,
        )
        return 2

    print(f"scraper spike: {len(TOPICS)} topics, plain HTTP, no browser")
    print(f"identifying as: {USER_AGENT}\n")
    results: list[Result] = []

    with httpx.Client(headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:
        for field, topic in TOPICS:
            result = fetch_topic(client, field, topic)
            results.append(result)
            status = "OK  " if result.ok else "FAIL"
            print(f"  {status} {topic:<26} {result.chars:>6} chars  {result.seconds:4.1f}s  {result.note}")

    usable = [r for r in results if r.ok]
    print(f"\nusable ({USABLE_CHARS}+ chars): {len(usable)}/{len(results)}")
    if usable:
        print(f"median length: {statistics.median(r.chars for r in usable):,.0f} chars")
        print(f"median fetch:  {statistics.median(r.seconds for r in usable):.1f}s")

    failures = [r for r in results if not r.ok]
    if failures:
        print("\nfailures:")
        for r in failures:
            print(f"  {r.topic}: {r.note}")

    print(f"\n{verdict(results)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
