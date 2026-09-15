"""Run one topic through the LangGraph pipeline - task 4b.1's done-condition.

Different from scripts/run_agents.py on purpose. That one calls each agent
directly, so a failure points at one agent. This one runs the compiled graph, so
what is being exercised is the orchestration: the concurrent pair, the join, and
the branch.

Run:  .venv/Scripts/python scripts/run_pipeline.py
      .venv/Scripts/python scripts/run_pipeline.py "TreeSet" "Java Collections"
"""

from __future__ import annotations

import asyncio
import sys
import time

from app.agents.scraper import ContactNotConfigured, build_client
from app.graph.pipeline import run_topic

DEFAULT_TOPIC = "HashMap"
DEFAULT_FIELD = "Java Collections"
DESCRIPTION = "The hash-table backed Map implementation in Java's collections library"

# Each outcome means something different, and they are kept apart so that "no
# cards" is never one undifferentiated failure.
EXPLAIN = {
    "ready": "cards passed the gate and would be persisted",
    "unsourced": "no source could ground it, so nothing was written (invariant 4)",
    "empty": "drafts existed but none survived fact-check (invariant 6)",
    "degraded": "the CHECKER failed, not the cards - do not blame the generator",
}


async def main() -> int:
    topic = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TOPIC
    field = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_FIELD

    try:
        client = build_client()
    except ContactNotConfigured as exc:
        print(exc, file=sys.stderr)
        return 2

    async with client:
        print(f"topic: {topic}   field: {field}\n")
        started = time.monotonic()
        result = await run_topic(
            client, topic=topic, field=field, description=DESCRIPTION
        )
        elapsed = time.monotonic() - started

        print(f"outcome  : {result.outcome}  - {EXPLAIN[result.outcome]}")
        if result.note:
            print(f"note     : {result.note}")
        if result.grounding and result.grounding.ok:
            g = result.grounding
            print(f"grounding: {g.chars:,} chars [{g.source_name}] {g.matched_title}")
        print(
            f"drafts   : {result.drafts_generated} generated, "
            f"{len(result.passed)} passed, {len(result.failed)} failed, "
            f"{len(result.malformed)} malformed, {len(result.checker_errors)} checker errors"
        )
        print(f"wall     : {elapsed:,.1f}s\n")

        for i, judged in enumerate(result.passed, start=1):
            print(f"  PASS [{i}] {judged.draft.content[:150]}")
        for i, judged in enumerate(result.failed, start=1):
            print(f"  FAIL [{i}] {judged.verdict.reason[:130]}")
            if judged.verdict.failed_claim:
                print(f"           claim: {judged.verdict.failed_claim[:120]}")

        return 0 if result.outcome == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
