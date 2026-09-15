"""Official Java API documentation as a grounding source (W4 task 4a.1c).

WHY THIS SOURCE EXISTS: Wikipedia has no article for HashMap, LinkedHashMap or
ConcurrentSkipListMap, and redirects TreeSet and ArrayList to general CS
concepts. No amount of better querying retrieves a page that does not exist, so
the only route to that content is a source that documents library APIs. See P26.

WHAT MAKES THIS SOURCE BETTER, not merely different: discovery is DETERMINISTIC.
The class name resolves to exactly one URL through two published indexes, so the
"wrong article" failure that produced P26 and P27 cannot occur here - a page is
either the class's own page or it is nothing.

THE SOFT-404 TRAP, found the hard way: the module-less URL
/java/util/HashMap.html returns **HTTP 200** and redirects to the JDK
documentation home page. Status and length both look healthy; the content is a
landing page. That is why the module segment is resolved properly below, and why
fetch() REQUIRES the class-description section to be present - the content check,
not the status code, is what distinguishes the real page from a plausible one.

Two indexes, fetched once each and cached:
    type-search-index.js     {"p": package, "l": class}   -> class -> package
    package-search-index.js  {"m": module,  "l": package} -> package -> module

Licensing: the text is never served. It grounds generation, and the card carries
source_url (P1, invariant 4). robots.txt permits the API docs; it disallows
/search/, which this source has no need for.
"""

from __future__ import annotations

import html
import json
import re

import httpx

from app.relevance import tokens
from app.sources.base import Page

BASE = "https://docs.oracle.com/en/java/javase/21/docs/api"
TYPE_INDEX_URL = f"{BASE}/type-search-index.js"
PACKAGE_INDEX_URL = f"{BASE}/package-search-index.js"

# Javadoc emits exactly one of these per class page; verified against a real page
# before relying on it. Machine-generated markup on a pinned version, so targeted
# extraction beats an HTML parser dependency - and when the shape is absent the
# match fails, which refuses the topic instead of returning a landing page.
_CLASS_DESC = re.compile(
    r'<section class="class-description".*?>(.*?)</section>', re.DOTALL
)
_TAG = re.compile(r"<[^>]+>")
_BLANK_LINES = re.compile(r"[ \t]*\n\s*\n\s*")

# When one class name lives in several packages (java.util.List and java.awt.List),
# prefer the core ones. The field hint is tried first; this is only the tie-break.
_PREFERRED = (
    "java.lang",
    "java.util",
    "java.util.concurrent",
    "java.io",
    "java.nio",
    "java.time",
)


def _parse_index(raw: str) -> list[dict[str, str]]:
    start, end = raw.find("["), raw.rfind("]")
    if start == -1 or end <= start:
        return []
    try:
        return json.loads(raw[start : end + 1])
    except ValueError:
        return []


class JavadocSource:
    name = "javadoc"

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        classes: dict[str, list[str]] | None = None,
        modules: dict[str, str] | None = None,
    ):
        self._client = client
        # Injectable so URL construction can be tested without the network.
        self._classes = classes
        self._modules = modules

    async def _ensure_indexes(self) -> None:
        if self._classes is not None and self._modules is not None:
            return

        classes: dict[str, list[str]] = {}
        modules: dict[str, str] = {}

        try:
            resp = await self._client.get(TYPE_INDEX_URL, timeout=60)
            for entry in _parse_index(resp.text):
                name, package = entry.get("l", ""), entry.get("p", "")
                # Nested classes appear as "Outer.Inner". Their URL shape differs
                # and they are not topic-sized, so they are skipped rather than
                # guessed at.
                if name and package and "." not in name:
                    classes.setdefault(name.lower(), []).append(package)
        except httpx.HTTPError:
            pass

        try:
            resp = await self._client.get(PACKAGE_INDEX_URL, timeout=60)
            for entry in _parse_index(resp.text):
                package, module = entry.get("l", ""), entry.get("m", "")
                if package and module:
                    modules[package] = module
        except httpx.HTTPError:
            pass

        self._classes = classes
        self._modules = modules

    async def candidates(self, topic: str, field: str) -> list[str]:
        """Fully-qualified class names, best guess first.

        Lookup is by EXACT class name, so P27's sibling trap cannot arise here:
        asking for HashMap can never return LinkedHashMap.

        Packages whose module is unknown are dropped, because a URL cannot be
        built without one and a guessed URL is how the soft-404 got in.
        """
        await self._ensure_indexes()
        assert self._classes is not None and self._modules is not None

        packages = [p for p in self._classes.get(topic.strip().lower(), []) if p in self._modules]
        if not packages:
            return []

        field_t = tokens(field)

        def rank(package: str) -> tuple[int, int, str]:
            overlap = len(tokens(package.replace(".", " ")) & field_t)
            preference = (
                _PREFERRED.index(package) if package in _PREFERRED else len(_PREFERRED)
            )
            return (-overlap, preference, package)

        cls = topic.strip()
        return [f"{p}.{cls}" for p in sorted(packages, key=rank)]

    def url_for(self, qualified: str) -> str | None:
        package, _, cls = qualified.rpartition(".")
        module = (self._modules or {}).get(package)
        if not module or not cls:
            return None
        return f"{BASE}/{module}/{package.replace('.', '/')}/{cls}.html"

    async def fetch(self, title: str) -> Page | None:
        await self._ensure_indexes()
        url = self.url_for(title)
        if url is None:
            return None
        try:
            resp = await self._client.get(url, timeout=30)
        except httpx.HTTPError:
            return None
        if resp.status_code != 200:
            return None

        # The content check, not the status code. A 200 here can still be the
        # JDK landing page; only the class-description section proves otherwise.
        match = _CLASS_DESC.search(resp.text)
        if match is None:
            return None
        text = html.unescape(_TAG.sub("", match.group(1)))
        text = _BLANK_LINES.sub("\n\n", text).strip()
        if not text:
            return None
        return Page(title=title, text=text, url=url)

    async def section(self, page: Page, topic: str) -> Page | None:
        """Not applicable. A Javadoc page is already about exactly one class, so
        there is no shared-article problem to extract a section out of."""
        return None
