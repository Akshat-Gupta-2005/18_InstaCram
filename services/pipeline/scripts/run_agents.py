"""Run all four agents for one topic, end to end - the 8a done-condition.

This is NOT the graph (that is 4b.1). Each agent is called directly and in order,
so a failure points at one agent rather than at orchestration. The scraper and
data-gen run concurrently here because they have no dependency on each other,
which is the parallelism 4b.2 will formalise.

Run:  .venv/Scripts/python scripts/run_agents.py
      .venv/Scripts/python scripts/run_agents.py "TreeSet" "Java Collections"
"""

from __future__ import annotations

import asyncio
import sys
import time

from app.agents.card_gen import SourceText, generate_cards
from app.agents.data_gen import generate_supplement
from app.agents.fact_check import check_card
from app.agents.scraper import (
    ContactNotConfigured,
    build_client,
    default_sources,
    ground_topic,
)
from app.llm import LLMError

DEFAULT_TOPIC = "HashMap"
DEFAULT_FIELD = "Java Collections"
DESCRIPTION = "The hash-table backed Map implementation in Java's collections library"


def rule(title: str) -> None:
    print(f"\n{'-' * 72}\n{title}\n{'-' * 72}")


async def main() -> int:
    topic = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TOPIC
    field = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_FIELD

    try:
        client = build_client()
    except ContactNotConfigured as exc:
        print(exc, file=sys.stderr)
        return 2

    async with client:
        print(f"topic: {topic}   field: {field}")

        rule("4a.1 scraper  +  4a.2 data-gen   (concurrent - no dependency)")
        started = time.monotonic()
        grounding, supplement = await asyncio.gather(
            ground_topic(topic, field, sources=default_sources(client)),
            generate_supplement(client, topic, DESCRIPTION),
        )
        concurrent_s = time.monotonic() - started

        if not grounding.ok:
            print(f"  scraper REFUSED: {grounding.reason}")
            print("\nNo grounding, so no cards. Invariant 4: a card with no")
            print("provenance must not be servable, so this topic is not written.")
            return 1

        print(f"  scraped    {grounding.chars:>7,} chars  [{grounding.source_name}] {grounding.matched_title}")
        print(f"  generated  {len(supplement.content):>7,} chars  confidence={supplement.confidence}")
        print(f"  both in {concurrent_s:,.1f}s")

        rule("4a.3 card generation")
        started = time.monotonic()
        drafts, rejected = await generate_cards(
            client,
            topic=topic,
            description=DESCRIPTION,
            sources=[SourceText(grounding.text, grounding.source_url)],
            supplement_content=supplement.content,
            supplement_confidence=supplement.confidence,
        )
        print(f"  {len(drafts)} draft(s), {len(rejected)} malformed, in {time.monotonic() - started:,.1f}s")
        for bad in rejected:
            print(f"    MALFORMED: {bad.reason}")
        for i, d in enumerate(drafts, start=1):
            print(f"\n  [{i}] {d.trust_label}  {d.source_url}")
            print(f"      {d.content[:220]}")
            print(f"      why: {d.why_it_matters[:140]}")
            print(f"      Q:   {d.recall_prompt[:140]}")

        if not drafts:
            print("\nNo usable drafts. Topic would be status='empty' and reported")
            print("to the user in failed_topics rather than silently omitted.")
            return 1

        rule("4a.4 fact-check   (the sole quality gate)")
        passed = failed = errored = 0
        for i, d in enumerate(drafts, start=1):
            started = time.monotonic()
            try:
                verdict = await check_card(
                    client,
                    card_content=d.content,
                    scraped=grounding.text,
                    generated=supplement.content,
                )
            except LLMError as exc:
                errored += 1
                print(f"  [{i}] CHECKER ERROR ({exc}) - not counted as a rejection")
                continue
            elapsed = time.monotonic() - started
            if verdict.passed:
                passed += 1
                print(f"  [{i}] PASS  {elapsed:,.1f}s  {verdict.reason[:110]}")
            else:
                failed += 1
                print(f"  [{i}] FAIL  {elapsed:,.1f}s  {verdict.reason[:110]}")
                if verdict.failed_claim:
                    print(f"       claim: {verdict.failed_claim[:140]}")

        rule("result")
        print(f"  drafts {len(drafts)}   passed {passed}   failed {failed}   checker errors {errored}")
        # Only over cards the checker actually judged. Dividing by all drafts
        # would report "0% rejected" when every card errored, which reads as
        # total success and is the opposite of what happened.
        judged = passed + failed
        print(f"  rejection rate: {failed / judged:.0%} of {judged} judged" if judged else
              "  rejection rate: n/a - the checker judged nothing")
        print("\n  A rejection rate this early is a sample of one topic, not a")
        print("  measurement. 8d takes it across many, which is the evidence the")
        print("  no-retry decision (P10) was deliberately left open for.")
        return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
