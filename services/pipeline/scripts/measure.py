"""Task 8d: the project's first real numbers.

Every quality figure so far comes from ONE topic, which is an anecdote. This runs
a set of topics and records what the plan asks for:

  - fact-check rejection rate
  - topics yielding zero surviving cards
  - wall-clock per topic, and the concurrency saving from 4b.2
  - cost per topic, which is now time and tokens rather than money
  - fact-check quality with thinking ON versus OFF

THE THINKING COMPARISON REUSES THE SAME DRAFTS. Regenerating for each arm would
change two variables at once and measure nothing: the second arm would be judging
different cards. Each draft is checked twice, so any disagreement is attributable
to the checker alone.

Results go to measurements/<timestamp>.json so a later run can be compared rather
than remembered. Run:

    .venv/Scripts/python scripts/measure.py
    .venv/Scripts/python scripts/measure.py --topics 4      (shorter run)
    .venv/Scripts/python scripts/measure.py --no-thinking   (skip the A/B)
"""

from __future__ import annotations

import asyncio
import json
import statistics
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import asyncpg

from app.agents.fact_check import check_card
from app.agents.scraper import ContactNotConfigured, build_client
from app.config import DATABASE_URL
from app.graph.pipeline import run_topic
from app.llm import LLMError
from app.repo.persist import create_topic_with_outbox
from app.workers.outbox import drain_once

OUT_DIR = Path(__file__).resolve().parents[1] / "measurements"

# Deliberately mixed. The technical half is where sourcing was hardest (P26) and
# the non-technical half is where it was easiest, so a rejection rate averaged
# over both is more honest than one drawn from either.
TOPICS: list[tuple[str, str, str]] = [
    ("HashMap", "Java Collections", "The hash-table backed Map implementation in Java"),
    ("TreeSet", "Java Collections", "The sorted Set implementation backed by a red-black tree"),
    ("ArrayList", "Java Collections", "The resizable-array List implementation in Java"),
    ("Loss aversion", "Behavioural Economics", "The tendency to prefer avoiding losses over acquiring equivalent gains"),
    ("Anchoring", "Behavioural Economics", "The bias where an initial value disproportionately influences later judgements"),
    ("Endowment effect", "Behavioural Economics", "The tendency to value something more highly once you own it"),
]


async def main() -> int:
    limit = int(sys.argv[sys.argv.index("--topics") + 1]) if "--topics" in sys.argv else len(TOPICS)
    do_thinking = "--no-thinking" not in sys.argv
    topics = TOPICS[:limit]

    try:
        client = build_client()
    except ContactNotConfigured as exc:
        print(exc, file=sys.stderr)
        return 2

    conn = await asyncpg.connect(DATABASE_URL)
    created: list[str] = []
    runs: list[dict] = []

    try:
        async with client:
            for i, (name, field, description) in enumerate(topics, start=1):
                print(f"\n[{i}/{len(topics)}] {name} ({field})")
                topic = await create_topic_with_outbox(conn, name=name, description=description)
                created.append(topic.id)

                started = time.monotonic()
                result = await run_topic(
                    client, topic=name, field=field, description=description,
                    conn=conn, topic_id=topic.id,
                )
                elapsed = time.monotonic() - started
                await drain_once(conn, client)

                run = {
                    "topic": name,
                    "field": field,
                    "outcome": result.outcome,
                    "seconds": round(elapsed, 1),
                    "drafts": result.drafts_generated,
                    "passed": len(result.passed),
                    "failed": len(result.failed),
                    "malformed": len(result.malformed),
                    "checker_errors": len(result.checker_errors),
                    "source": result.grounding.source_name if result.grounding else None,
                    "grounding_chars": result.grounding.chars if result.grounding else 0,
                    # >1 per card means the source was chunked. Worth recording
                    # next to grounding_chars: it is the evidence that a long
                    # source was actually READ rather than silently truncated
                    # past the context window, which is how a whole run of this
                    # script once reported a meaningless 0.0 rejection rate.
                    "fact_check_calls": sum(
                        j.verdict.chunks_checked for j in [*result.passed, *result.failed]
                    ),
                    "agreements": [],
                }
                print(f"     {result.outcome}  {run['passed']}/{run['drafts']} passed  {elapsed:,.0f}s"
                      f"  [{run['source']}]")
                for judged in result.failed:
                    print(f"     rejected: {judged.verdict.reason[:100]}")

                # The A/B, over the drafts this run already produced.
                if do_thinking and (result.passed or result.failed):
                    for judged in [*result.passed, *result.failed]:
                        try:
                            other = await check_card(
                                client,
                                card_content=judged.draft.content,
                                scraped=result.grounding.text if result.grounding else "",
                                generated="",
                                model="thinking",
                            )
                        except LLMError as exc:
                            run["agreements"].append({"agree": None, "error": str(exc)[:120]})
                            continue
                        run["agreements"].append({
                            "no_think": judged.verdict.passed,
                            "thinking": other.passed,
                            "agree": judged.verdict.passed == other.passed,
                            "thinking_reason": other.reason[:160],
                        })
                    agree = [a for a in run["agreements"] if a.get("agree") is True]
                    print(f"     thinking A/B: {len(agree)}/{len(run['agreements'])} verdicts agreed")

                runs.append(run)

        # ---------------- summary ----------------
        drafts = sum(r["drafts"] for r in runs)
        passed = sum(r["passed"] for r in runs)
        failed = sum(r["failed"] for r in runs)
        errors = sum(r["checker_errors"] for r in runs)
        # Summed because the first run of this script did NOT sum it, and the
        # headline "20 drafts generated" concealed 4 more the generator returned
        # malformed - a 17% rate, with TreeSet losing 3 of its 4. A per-run field
        # that no summary adds up is a field nobody reads.
        malformed = sum(r["malformed"] for r in runs)
        zero_card = [r for r in runs if r["passed"] == 0]
        times = [r["seconds"] for r in runs]
        judged = passed + failed

        agreements = [a for r in runs for a in r["agreements"] if a.get("agree") is not None]
        agreed = [a for a in agreements if a["agree"]]

        summary = {
            "generated_at": datetime.now(UTC).isoformat(),
            "topics": len(runs),
            "drafts_generated": drafts,
            "drafts_malformed": malformed,
            "drafts_attempted": drafts + malformed,
            "malformed_rate": round(malformed / (drafts + malformed), 3) if drafts + malformed else None,
            "drafts_passed": passed,
            "drafts_failed": failed,
            "checker_errors": errors,
            # How many model calls the gate actually spent. A topic whose source
            # needed chunking costs several calls per card; one that fit costs
            # one. Recorded so "the gate passed it" can be told apart from "the
            # gate never ran on it" (P33).
            "fact_check_calls": sum(r["fact_check_calls"] for r in runs),
            # Over drafts the checker actually JUDGED. Dividing by all drafts
            # would dilute the rate with rows the checker never ruled on.
            "rejection_rate": round(failed / judged, 3) if judged else None,
            "zero_card_topics": [r["topic"] for r in zero_card],
            "outcomes": {o: sum(1 for r in runs if r["outcome"] == o)
                         for o in {r["outcome"] for r in runs}},
            "seconds_per_topic": {
                "min": min(times), "median": statistics.median(times), "max": max(times),
                "total": round(sum(times), 1),
            },
            "thinking_ab": {
                "verdicts_compared": len(agreements),
                "agreed": len(agreed),
                "agreement_rate": round(len(agreed) / len(agreements), 3) if agreements else None,
            },
            "runs": runs,
        }

        OUT_DIR.mkdir(exist_ok=True)
        stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        path = OUT_DIR / f"{stamp}.json"
        path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

        print("\n" + "=" * 62)
        print(f"topics            : {len(runs)}")
        print(f"drafts            : {drafts + malformed} attempted, {malformed} malformed "
              f"({summary['malformed_rate']}), {drafts} valid")
        print(f"verdicts          : {passed} passed, {failed} rejected, {errors} checker errors")
        print(f"fact-check calls  : {summary['fact_check_calls']} "
              f"(>1 per card means the source was chunked)")
        print(f"rejection rate    : {summary['rejection_rate']} (of {judged} judged)")
        print(f"zero-card topics  : {len(zero_card)}  {zero_card and [r['topic'] for r in zero_card] or ''}")
        print(f"outcomes          : {summary['outcomes']}")
        print(f"seconds per topic : min {min(times):,.0f}  median {statistics.median(times):,.0f}  max {max(times):,.0f}")
        print(f"total wall-clock  : {sum(times) / 60:,.1f} min")
        if agreements:
            print(f"thinking A/B      : {len(agreed)}/{len(agreements)} verdicts agreed "
                  f"({summary['thinking_ab']['agreement_rate']})")
        print(f"\nwritten to {path.relative_to(OUT_DIR.parent)}")
        return 0

    finally:
        for topic_id in created:
            await conn.execute("DELETE FROM outbox WHERE topic_id=$1", topic_id)
            await conn.execute("DELETE FROM topic_generation_stats WHERE topic_id=$1", topic_id)
            await conn.execute("DELETE FROM rejected_draft WHERE topic_id=$1", topic_id)
            await conn.execute("UPDATE scroll SET retired_at=now() WHERE topic_id=$1", topic_id)
        await conn.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
