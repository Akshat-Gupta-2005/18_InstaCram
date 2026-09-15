"""Run the Web Scraping Agent standalone - task 4a.1's done-condition.

Grounds the same 10 topics the spike used, so the two are directly comparable.
The spike scored 10/10 on "did text come back". This scores on "is the text
about the topic", which is the question that actually matters and the one the
spike could not ask. See Docs/DECISIONS.md P26.

Run:  .venv/Scripts/python scripts/run_scraper.py
      .venv/Scripts/python scripts/run_scraper.py --no-db   (skip recording)
"""

from __future__ import annotations

import asyncio
import sys

import asyncpg

from app.agents.scraper import (
    ContactNotConfigured,
    build_client,
    default_sources,
    ground_topic,
)
from app.config import DATABASE_URL
from app.repo.unsourced import counts_by_field

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


async def main() -> int:
    use_db = "--no-db" not in sys.argv

    try:
        client = build_client()
    except ContactNotConfigured as exc:
        print(f"{exc}", file=sys.stderr)
        return 2

    conn = None
    if use_db:
        try:
            conn = await asyncpg.connect(DATABASE_URL, timeout=5)
        except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
            print(f"no database ({exc}); continuing without recording\n", file=sys.stderr)

    grounded: list[str] = []
    refused: list[str] = []

    async with client:
        sources = default_sources(client)
        for field, topic in TOPICS:
            g = await ground_topic(topic, field, sources=sources, conn=conn)
            if g.ok:
                grounded.append(topic)
                print(
                    f"  OK       {topic:<24} {g.chars:>7,} chars  "
                    f"[{g.source_name}] <- {g.matched_title}"
                )
            else:
                refused.append(topic)
                print(f"  REFUSED  {topic:<24} {'':>7}         {g.reason}")

    total = len(TOPICS)
    print(f"\ngrounded : {len(grounded)}/{total}")
    print(f"refused  : {len(refused)}/{total}   {', '.join(refused) if refused else ''}")
    print(
        "\nThe spike scored 10/10 on the same topics by counting characters.\n"
        "Anything refused above would have been grounded on the wrong article."
    )

    if conn is not None:
        rows = await counts_by_field(conn)
        print("\nunsourced_topic, by field:")
        for r in rows:
            print(
                f"  {r['topics']:>3} topic(s), {r['detections']:>3} detection(s)"
                f"  {r['field_name']}"
            )
        await conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
