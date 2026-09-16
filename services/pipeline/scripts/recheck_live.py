"""Re-run the fact-check gate over cards that were passed while it was blind.

P33: for any topic whose source ran longer than one context window, the checker
was handed a prompt whose front - the card - had been silently truncated away. It
returned confident passes on cards it had never seen, and those cards carry
`trust_label = 'sourced_verified'`, which is the claim invariant 4 exists to
protect. The gate is fixed; the rows it stamped are not.

Re-grounding rather than replaying: the original scrape text was never stored, and
re-fetching is the more honest check anyway - it verifies the card against the
source as it stands now, which is what a reader following the link would see.

DRY RUN BY DEFAULT. Retiring a card is reversible (retired_at goes back to NULL)
but it is still a write against live rows, so it takes an explicit flag:

    .venv/Scripts/python scripts/recheck_live.py              report only
    .venv/Scripts/python scripts/recheck_live.py --retire     act on the result
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import asyncpg

from app.agents.fact_check import check_card
from app.agents.scraper import ContactNotConfigured, build_client, default_sources, ground_topic
from app.config import DATABASE_URL
from app.llm import LLMError

OUT_DIR = Path(__file__).resolve().parents[1] / "measurements"

# One row per live scroll, with the field its topic belongs to. DISTINCT ON keeps
# a topic linked to several fields from listing its cards more than once - the
# field only picks which source to try first, so any one of them will do.
QUERY = """
SELECT DISTINCT ON (s.id)
       s.id, s.content, s.topic_id, s.trust_label,
       t.name AS topic_name, COALESCE(f.name, '') AS field_name
FROM live_scroll s
JOIN topic t ON t.id = s.topic_id
LEFT JOIN field_topic ft ON ft.topic_id = t.id
LEFT JOIN field f ON f.id = ft.field_id
ORDER BY s.id, f.name
"""


async def main() -> int:
    retire = "--retire" in sys.argv

    try:
        client = build_client()
    except ContactNotConfigured as exc:
        print(exc, file=sys.stderr)
        return 2

    conn = await asyncpg.connect(DATABASE_URL)
    rows = await conn.fetch(QUERY)

    if not rows:
        print("no live scrolls to check")
        await conn.close()
        return 0

    by_topic: dict[str, list[asyncpg.Record]] = {}
    for row in rows:
        by_topic.setdefault(row["topic_name"], []).append(row)

    print(f"{len(rows)} live scrolls across {len(by_topic)} topics"
          f"{'' if retire else '  (DRY RUN - nothing will be written)'}\n")

    results: list[dict] = []
    to_retire: list[str] = []

    try:
        async with client:
            for topic_name, scrolls in by_topic.items():
                field = scrolls[0]["field_name"]
                grounding = await ground_topic(
                    topic_name, field, sources=default_sources(client)
                )
                if not grounding.ok:
                    # Cannot re-verify without a source. NOT retired: an unsourced
                    # topic today says nothing about whether the card was true
                    # when it was written, and retiring on that basis would delete
                    # good cards whenever a source went down.
                    print(f"{topic_name}: could not re-ground ({grounding.reason[:80]}) "
                          f"- {len(scrolls)} card(s) left alone")
                    for s in scrolls:
                        results.append({"scroll": str(s["id"]), "topic": topic_name,
                                        "outcome": "ungroundable"})
                    continue

                print(f"{topic_name}  [{grounding.source_name}, {grounding.chars:,} chars]")
                for s in scrolls:
                    try:
                        verdict = await check_card(
                            client, card_content=s["content"],
                            scraped=grounding.text, generated="",
                        )
                    except LLMError as exc:
                        # Same rule as the pipeline: a checker that errored has
                        # not condemned anything.
                        print(f"  {str(s['id'])[:8]}  CHECKER ERROR - left alone: {exc}")
                        results.append({"scroll": str(s["id"]), "topic": topic_name,
                                        "outcome": "checker_error", "detail": str(exc)[:200]})
                        continue

                    print(f"  {str(s['id'])[:8]}  {verdict.label}  "
                          f"({verdict.chunks_checked} call(s))  {verdict.reason[:90]}")
                    results.append({
                        "scroll": str(s["id"]), "topic": topic_name,
                        "outcome": verdict.label,
                        "fact_check_calls": verdict.chunks_checked,
                        "grounding_chars": grounding.chars,
                        "reason": verdict.reason[:300],
                        "failed_claim": verdict.failed_claim,
                    })
                    if not verdict.passed:
                        to_retire.append(s["id"])

        if retire and to_retire:
            # Retired, never deleted - invariant 12, enforced by a trigger that
            # would reject a DELETE here anyway.
            await conn.execute(
                "UPDATE scroll SET retired_at = now() WHERE id = ANY($1::uuid[])",
                to_retire,
            )

        summary = {
            "generated_at": datetime.now(UTC).isoformat(),
            "dry_run": not retire,
            "scrolls_checked": len(results),
            "passed": sum(1 for r in results if r["outcome"] == "pass"),
            "failed": sum(1 for r in results if r["outcome"] == "fail"),
            "checker_errors": sum(1 for r in results if r["outcome"] == "checker_error"),
            "ungroundable": sum(1 for r in results if r["outcome"] == "ungroundable"),
            "retired": len(to_retire) if retire else 0,
            "results": results,
        }

        OUT_DIR.mkdir(exist_ok=True)
        path = OUT_DIR / f"recheck-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}.json"
        path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

        print("\n" + "=" * 62)
        print(f"checked        : {summary['scrolls_checked']}")
        print(f"passed         : {summary['passed']}")
        print(f"failed         : {summary['failed']}")
        print(f"checker errors : {summary['checker_errors']} (left alone)")
        print(f"ungroundable   : {summary['ungroundable']} (left alone)")
        if to_retire and not retire:
            print(f"\nwould retire {len(to_retire)} card(s); re-run with --retire to do it")
        elif retire:
            print(f"\nretired {len(to_retire)} card(s)")
        print(f"\nwritten to {path.relative_to(OUT_DIR.parent)}")
        return 0

    finally:
        await conn.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
