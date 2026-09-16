"""Negative control for the fact-check gate (follows task 8d).

The 6-topic measurement returned a rejection rate of 0.000 — 20 drafts judged, 20
passed. That number has two explanations that the measurement CANNOT tell apart:

  1. the generator is faithful because it is writing from real scraped text, or
  2. the checker passes whatever it is given.

Both produce 0.000. This is the mirror image of P10 (an over-strict checker and a
weak generator produce the same rate) and the same shape as P26: a measurement
that cannot express the failure can only report success.

So this feeds the checker cards that are KNOWN to be wrong, against real grounding
text fetched by the real scraper. Each planted card contradicts a specific,
checkable statement in its source. A gate that passes these is not a gate, and its
0.000 means nothing.

Every planted error is one the prompt's own fail list names: contradicts the
source material, or a specific figure/bound that is wrong. None of them are the
things the prompt says NOT to fail for (incompleteness, simplification, style), so
a rejection here is not evidence of over-strictness either.

    .venv/Scripts/python scripts/negative_control.py
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from app.agents.fact_check import check_card
from app.agents.scraper import ContactNotConfigured, build_client, default_sources, ground_topic
from app.llm import LLMError

OUT_DIR = Path(__file__).resolve().parents[1] / "measurements"

# (label, card_content, should_pass)
Case = tuple[str, str, bool]

_HASHMAP_OPENING = "HashMap is the hash-table backed implementation of the Map interface. "
_LOSS_OPENING = (
    "Loss aversion is the tendency for a loss to weigh more heavily than an "
    "equivalent gain. "
)

HASHMAP: list[Case] = [
    (
        "control-faithful",
        _HASHMAP_OPENING + (
            "It offers constant-time performance for the basic get and put "
            "operations, assuming the hash function disperses elements properly "
            "among the buckets."
        ),
        True,
    ),
    (
        "planted-thread-safety",
        _HASHMAP_OPENING + (
            "It is synchronized internally, so several threads may modify the same "
            "HashMap concurrently without any external synchronization."
        ),
        False,
    ),
    (
        "planted-complexity",
        _HASHMAP_OPENING + (
            "Its get and put operations run in O(log n) time, because entries are "
            "held in a balanced tree ordered by key."
        ),
        False,
    ),
    (
        "planted-nulls",
        _HASHMAP_OPENING + (
            "It permits neither null keys nor null values: passing null to put "
            "throws a NullPointerException."
        ),
        False,
    ),
    (
        "planted-ordering",
        _HASHMAP_OPENING + (
            "It iterates its entries in the order they were inserted, so iteration "
            "order is stable and can be relied upon."
        ),
        False,
    ),
]

LOSS_AVERSION: list[Case] = [
    (
        "control-faithful",
        _LOSS_OPENING + (
            "Losing a sum of money produces a larger change in felt wellbeing than "
            "gaining the same sum."
        ),
        True,
    ),
    (
        "planted-inverted",
        (
            "Loss aversion is the finding that people weigh gains more heavily than "
            "equivalent losses. Gaining a sum of money produces a larger change in "
            "felt wellbeing than losing the same sum does."
        ),
        False,
    ),
    (
        "planted-attribution",
        _LOSS_OPENING + (
            "It was first identified by B. F. Skinner in his 1953 work on operant "
            "conditioning."
        ),
        False,
    ),
    (
        "planted-figure",
        _LOSS_OPENING + (
            "Empirical estimates put the loss-aversion coefficient at about 0.5, "
            "meaning a loss weighs roughly half as much as an equal gain."
        ),
        False,
    ),
]

SUBJECTS = [
    ("HashMap", "Java Collections", HASHMAP),
    ("Loss aversion", "Behavioural Economics", LOSS_AVERSION),
]


async def main() -> int:
    try:
        client = build_client()
    except ContactNotConfigured as exc:
        print(exc, file=sys.stderr)
        return 2

    results: list[dict] = []

    async with client:
        for topic, field, cases in SUBJECTS:
            grounding = await ground_topic(
                topic, field, sources=default_sources(client)
            )
            if not grounding.ok:
                print(f"{topic}: could not ground ({grounding.reason}) — skipping",
                      file=sys.stderr)
                continue

            print(f"\n{topic}  [{grounding.source_name}, {grounding.chars:,} chars]")
            for label, content, should_pass in cases:
                try:
                    verdict = await check_card(
                        client, card_content=content,
                        scraped=grounding.text, generated="",
                    )
                except LLMError as exc:
                    print(f"  {label:<24} CHECKER ERROR  {exc}")
                    results.append({"topic": topic, "case": label,
                                    "expected_pass": should_pass, "error": str(exc)[:200]})
                    continue

                correct = verdict.passed == should_pass
                mark = "ok " if correct else "MISS"
                print(f"  {label:<24} {verdict.label:<5} expected {'pass' if should_pass else 'fail':<5} {mark}")
                print(f"      {verdict.reason[:150]}")
                results.append({
                    "topic": topic, "case": label,
                    "expected_pass": should_pass, "passed": verdict.passed,
                    "correct": correct, "reason": verdict.reason[:300],
                    "failed_claim": verdict.failed_claim,
                })

    judged = [r for r in results if "correct" in r]
    planted = [r for r in judged if not r["expected_pass"]]
    controls = [r for r in judged if r["expected_pass"]]
    caught = [r for r in planted if r["correct"]]
    kept = [r for r in controls if r["correct"]]

    summary = {
        "generated_at": datetime.now(UTC).isoformat(),
        "planted_errors": len(planted),
        "planted_caught": len(caught),
        "detection_rate": round(len(caught) / len(planted), 3) if planted else None,
        "controls": len(controls),
        "controls_passed": len(kept),
        "checker_errors": len(results) - len(judged),
        "results": results,
    }

    OUT_DIR.mkdir(exist_ok=True)
    path = OUT_DIR / f"negative-control-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}.json"
    path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    print("\n" + "=" * 62)
    print(f"planted errors caught : {len(caught)}/{len(planted)}")
    print(f"faithful cards kept   : {len(kept)}/{len(controls)}")
    print(f"checker errors        : {summary['checker_errors']}")
    print(f"\nwritten to {path.relative_to(OUT_DIR.parent)}")

    # A gate that catches nothing is the result worth failing on.
    return 0 if planted and len(caught) == len(planted) and len(kept) == len(controls) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
