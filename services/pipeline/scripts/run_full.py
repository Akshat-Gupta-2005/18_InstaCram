"""One topic, all the way to persisted and vectorised - 8c's done-condition.

This is the first run where the pipeline's output actually survives. It does the
whole cache-miss path that W5 will later trigger automatically:

  1. create the topic row AND its outbox row in one transaction   (4c.4)
  2. run the graph: scrape, generate, write, fact-check           (8a/8b)
  3. persist cards, quarantine failures, bump counters, set status (4c.1-4c.3)
  4. drain the outbox so the topic's vector exists                 (4c.5)
  5. read it all back and check it against the invariants

Run:  .venv/Scripts/python scripts/run_full.py
      .venv/Scripts/python scripts/run_full.py "TreeSet" "Java Collections"
      .venv/Scripts/python scripts/run_full.py --keep     (do not clean up)
"""

from __future__ import annotations

import asyncio
import sys

import asyncpg

from app.agents.scraper import ContactNotConfigured, build_client
from app.config import DATABASE_URL
from app.graph.pipeline import run_topic
from app.repo.persist import create_topic_with_outbox
from app.stores.qdrant import TOPIC_NAME_COLLECTION, point_exists
from app.workers.outbox import drain_once

DEFAULT_TOPIC = "HashMap"
DEFAULT_FIELD = "Java Collections"
DESCRIPTION = "The hash-table backed Map implementation in Java's collections library"

EXPLAIN = {
    "ready": "cards passed the gate and were persisted",
    "unsourced": "no source could ground it; nothing written (invariant 4)",
    "empty": "drafts existed but none survived fact-check (invariant 6)",
    "degraded": "the CHECKER failed, not the cards - topic left pending, nothing quarantined",
}


async def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep = "--keep" in sys.argv
    topic_name = args[0] if args else DEFAULT_TOPIC
    field = args[1] if len(args) > 1 else DEFAULT_FIELD

    try:
        client = build_client()
    except ContactNotConfigured as exc:
        print(exc, file=sys.stderr)
        return 2

    conn = await asyncpg.connect(DATABASE_URL)
    topic = None
    try:
        print(f"topic: {topic_name}   field: {field}\n")

        print("1. topic + outbox row, one transaction")
        topic = await create_topic_with_outbox(
            conn, name=topic_name, description=DESCRIPTION
        )
        print(f"   topic_id = {topic.id}")

        print("\n2-3. running the pipeline")
        async with client:
            result = await run_topic(
                client,
                topic=topic_name,
                field=field,
                description=DESCRIPTION,
                conn=conn,
                topic_id=topic.id,
            )
            print(f"   outcome: {result.outcome}  - {EXPLAIN[result.outcome]}")
            if result.note:
                print(f"   note   : {result.note}")

            print("\n4. draining the outbox")
            report = await drain_once(conn, client)
            print(f"   claimed={report.claimed} written={report.written} retried={report.retried}")

            print("\n5. reading it back")
            scrolls = await conn.fetch(
                "SELECT content, source_url, trust_label FROM live_scroll WHERE topic_id=$1",
                topic.id,
            )
            rejected = await conn.fetchval(
                "SELECT count(*) FROM rejected_draft WHERE topic_id=$1", topic.id
            )
            stats = await conn.fetchrow(
                "SELECT drafts_generated, drafts_passed, drafts_failed, runs "
                "FROM topic_generation_stats WHERE topic_id=$1",
                topic.id,
            )
            status = await conn.fetchval("SELECT status FROM topic WHERE id=$1", topic.id)
            has_vector = await point_exists(client, TOPIC_NAME_COLLECTION, topic.id)

            print(f"   scrolls persisted : {len(scrolls)}")
            print(f"   quarantined       : {rejected}")
            print(f"   counters          : {dict(stats) if stats else 'none'}")
            print(f"   topic.status      : {status}")
            print(f"   topic vector      : {'present' if has_vector else 'MISSING'}")

            print("\n   invariants:")
            checks = [
                ("4  every card has provenance",
                 all(s["source_url"] and s["trust_label"] for s in scrolls)),
                ("5  the topic has exactly one vector", has_vector),
                ("6  zero cards implies status='empty'",
                 bool(scrolls) or status == "empty" or result.outcome == "degraded"),
                ("counters match what was persisted",
                 stats is not None and stats["drafts_passed"] == len(scrolls)),
            ]
            for label, ok in checks:
                print(f"     {'PASS' if ok else 'FAIL'}  {label}")

            for i, s in enumerate(scrolls, start=1):
                print(f"\n   [{i}] {s['trust_label']}")
                print(f"       {s['content'][:180]}")

            return 0 if all(ok for _, ok in checks) else 1
    finally:
        if topic and not keep:
            await conn.execute("DELETE FROM outbox WHERE topic_id=$1", topic.id)
            await conn.execute("DELETE FROM topic_generation_stats WHERE topic_id=$1", topic.id)
            await conn.execute("DELETE FROM rejected_draft WHERE topic_id=$1", topic.id)
            # Scrolls are never hard-deleted (invariant 12), so the test topic is
            # retired rather than removed, and its cascade is left to erasure.
            await conn.execute("UPDATE scroll SET retired_at=now() WHERE topic_id=$1", topic.id)
            print("\n(cleaned up; scrolls retired rather than deleted - invariant 12)")
        await conn.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
