"""Wikipedia as a grounding source, over the plain HTTP API.

The spike settled the transport question: 10/10 topics retrieved in ~1.1s each
with no browser, so Playwright is not needed here. What it did NOT settle is
whether the right article comes back - see app/relevance.py and P26.

Licensing: Wikipedia text is CC BY-SA, which requires attribution. The design
already satisfies that by storing and displaying source_url with every card, and
by never serving scraped text verbatim (P1).
"""

from __future__ import annotations

import re
import urllib.robotparser
from urllib.parse import quote, urlparse

import httpx

from app.relevance import classify, tokens
from app.sources.base import Page

API = "https://en.wikipedia.org/w/api.php"
SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary"

# prop=extracts&explaintext renders headings as "== Heading ==", nested deeper
# with more '='. This is the only structure a plain-text extract retains, and it
# is what makes section-level extraction possible without parsing HTML.
_HEADING = re.compile(r"^(={2,6})\s*(.+?)\s*\1\s*$", re.MULTILINE)


class WikipediaSource:
    name = "wikipedia"

    def __init__(self, client: httpx.AsyncClient, min_section_chars: int = 400):
        self._client = client
        self._min_section_chars = min_section_chars
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    async def allowed(self, url: str) -> bool:
        """Ask the host's robots.txt before fetching. Cheap, cached per host, and
        the line between automated reading and ignoring what the site asked for.
        An unreachable robots.txt disallows nothing."""
        parsed = urlparse(url)
        host = f"{parsed.scheme}://{parsed.netloc}"
        if host not in self._robots:
            parser = urllib.robotparser.RobotFileParser()
            try:
                resp = await self._client.get(f"{host}/robots.txt", timeout=15)
                parser.parse(resp.text.splitlines())
                self._robots[host] = parser
            except httpx.HTTPError:
                self._robots[host] = None
        parser = self._robots[host]
        if parser is None:
            return True
        agent = self._client.headers.get("User-Agent", "*")
        return parser.can_fetch(agent, url)

    def page_url(self, title: str) -> str:
        return f"https://en.wikipedia.org/wiki/{quote(title.replace(' ', '_'))}"

    async def _direct(self, topic: str) -> str | None:
        """The article literally named after the topic, following redirects.

        Finds "Availability heuristic", which search misses by returning the
        broader "Heuristic". It is tried FIRST because an exact title is a
        stronger signal than a search ranking - but it is not trusted on its own:
        looking up "Anchoring" this way returns "Anchor", the nautical one, which
        the relevance check then rejects.
        """
        url = f"{SUMMARY}/{quote(topic.strip().replace(' ', '_'))}"
        try:
            resp = await self._client.get(url, timeout=30)
            if resp.status_code != 200:
                return None
            title = str(resp.json().get("title", "")).strip()
        except (httpx.HTTPError, ValueError):
            return None
        return title or None

    async def _search(self, topic: str, field: str) -> str | None:
        # The field biases discovery, so "Stack" under Web Development cannot
        # silently return the data-structure article. It is a weak signal, not a
        # guarantee - which is exactly why the relevance check runs afterwards.
        params = {
            "action": "query",
            "list": "search",
            "srsearch": f"{topic} {field}".strip(),
            "srlimit": "1",
            "format": "json",
        }
        try:
            resp = await self._client.get(API, params=params, timeout=30)
            hits = resp.json().get("query", {}).get("search", [])
        except (httpx.HTTPError, ValueError):
            return None
        if not hits:
            return None
        title = str(hits[0].get("title", "")).strip()
        return title or None

    async def candidates(self, topic: str, field: str) -> list[str]:
        """Direct title first, then search. Neither strategy wins on its own -
        each finds a topic the other misses - and offering both is only safe
        because the relevance check rejects the wrong one. See P26/P27."""
        found = [await self._direct(topic), await self._search(topic, field)]
        seen: list[str] = []
        for title in found:
            if title and title not in seen:
                seen.append(title)
        return seen

    async def fetch(self, title: str) -> Page | None:
        url = self.page_url(title)
        if not await self.allowed(url):
            return None
        params = {
            "action": "query",
            "prop": "extracts",
            "explaintext": "1",
            "titles": title,
            "format": "json",
        }
        try:
            resp = await self._client.get(API, params=params, timeout=30)
            pages = resp.json().get("query", {}).get("pages", {})
            text = next(iter(pages.values()), {}).get("extract", "")
        except (httpx.HTTPError, ValueError):
            return None
        if not text:
            return None
        return Page(title=title, text=text, url=url)

    async def section(self, page: Page, topic: str) -> Page | None:
        """Task 4a.1d. When several topics share one article - four Java topics
        all matched 'Java collections framework' - the article may still contain
        a section that IS about the topic. Grounding on that section is far
        better than grounding on 22,789 chars about everything.

        Returns None when no section matches, which degrades cleanly to the
        mismatch path rather than silently handing back the whole page.
        """
        wanted = tokens(topic)
        if not wanted:
            return None

        matches = list(_HEADING.finditer(page.text))
        for i, m in enumerate(matches):
            heading = m.group(2)
            # Sibling rules: the heading must BE the topic, not merely contain it.
            # Containment accepted the LinkedHashMap section when asked for
            # HashMap, and CopyOnWriteArrayList when asked for ArrayList - the
            # sections of one article are confusable peers, not a hierarchy.
            if not classify(topic, heading, siblings=True).usable:
                continue
            start = m.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(page.text)
            body = page.text[start:end].strip()
            if len(body) < self._min_section_chars:
                continue
            return Page(
                title=f"{page.title} § {heading}",
                text=body,
                url=f"{page.url}#{quote(heading.replace(' ', '_'))}",
            )
        return None
