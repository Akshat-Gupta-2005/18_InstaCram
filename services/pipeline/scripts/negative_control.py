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
    .venv/Scripts/python scripts/negative_control.py --confirm   (measure the confirmation step)
    .venv/Scripts/python scripts/negative_control.py --set holdout [--confirm]
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

# The cases below are NOT invented. They are real drafts from the first live run
# through the P33-fixed gate, copied verbatim from rejected_draft.
#
# The negative control above only ever measured LENIENCY - does the gate catch a
# planted lie. It never measured OVER-STRICTNESS, and live data showed that is the
# failure that actually happens on the chunked path: three TRUE cards were
# rejected because an excerpt discussed something the card did not claim - more
# detail, or a different implementation. With no retry, each was a card lost for
# good. These are the faithful controls that were missing.
LINKED_LIST: list[Case] = [
    (
        "live-true-both-directions",
        (
            "Each node in a doubly-linked list holds a value and pointers to both the "
            "next and previous nodes, allowing you to move forward or backward through "
            "the list."
        ),
        True,
    ),
    # A real generator error the gate caught - but on a weak inference, not an
    # actual contradiction. Kept as an expected FAILURE so a fix for over-strictness
    # that turns this lucky catch into a miss is seen, not hidden. LISP's lists are
    # SINGLY linked cons cells.
    (
        "live-false-lisp",
        (
            "Doubly-linked lists are used in programming languages like LISP and in "
            "early AI systems because they make it easy to build and modify complex "
            "data structures."
        ),
        False,
    ),
]

PRIORITY_QUEUE: list[Case] = [
    (
        "live-true-heap-log-n",
        (
            "Inserting and removing elements from a priority queue using a heap takes "
            "O(log n) time, making it efficient for large datasets. This is because the "
            "heap maintains the priority order through a binary tree structure."
        ),
        True,
    ),
    (
        "live-true-bst-alternative",
        (
            "Priority queues can be implemented with other structures like "
            "self-balancing binary search trees, but they usually rely on heaps for "
            "better performance. These trees allow for O(log n) time complexity for "
            "insertion and deletion."
        ),
        True,
    ),
]

# ---------------------------------------------------------------- HELD-OUT SET
#
# Written BEFORE the second confirmation prompt, and never to be shown to it or
# used to tune it. The first confirmation prompt used the linked-list and
# priority-queue cases above as its own examples and then scored 5/5 on them,
# which measured memory, not judgement. These cases are on topics the prompts do
# not mention, and are run once per prompt version; tuning a prompt until they
# pass would turn them into a second development set and the number into the
# same illusion.
#
# Each true card is shaped like a live false rejection: the source says MORE than
# the card, or also describes a different variant. Each lie is shaped like a
# planted error the gate must keep catching: an inversion, a wrong attribution.
ANCHORING: list[Case] = [
    (
        "holdout-true-arbitrary-number",
        (
            "In anchoring experiments, an arbitrary number shown to participants can "
            "pull their later numerical estimates toward that number, even when they "
            "know it is irrelevant."
        ),
        True,
    ),
    (
        "holdout-lie-inverted",
        (
            "Anchoring is the tendency to give the first piece of information offered "
            "almost no weight, so an initial value has little effect on later estimates."
        ),
        False,
    ),
    (
        "holdout-lie-attribution",
        (
            "The anchoring effect was first described by Sigmund Freud in 1920, in his "
            "work on unconscious bias in judgement."
        ),
        False,
    ),
]

ENDOWMENT: list[Case] = [
    (
        "holdout-true-mug-experiment",
        (
            "In classic experiments, people who were given a mug typically asked for "
            "more money to sell it than other people were willing to pay to buy one."
        ),
        True,
    ),
    (
        "holdout-lie-inverted",
        (
            "The endowment effect is the tendency to value an object less once you own "
            "it, so owners typically ask lower prices than buyers are willing to pay."
        ),
        False,
    ),
]

QUEUE: list[Case] = [
    (
        "holdout-true-circular-buffer",
        (
            "A queue built on a circular buffer can add an element at the back and "
            "remove one from the front in constant time."
        ),
        True,
    ),
    (
        "holdout-lie-lifo",
        (
            "A queue follows last-in, first-out order: the element added most recently "
            "is the first one removed."
        ),
        False,
    ),
]

SUBJECT_SETS = {
    "dev": [
        ("HashMap", "Java Collections", HASHMAP),
        ("Loss aversion", "Behavioural Economics", LOSS_AVERSION),
        ("LinkedList", "Java Data Structures", LINKED_LIST),
        ("PriorityQueue", "Java Data Structures", PRIORITY_QUEUE),
    ],
    "holdout": [
        ("Anchoring", "Behavioural Economics", ANCHORING),
        ("Endowment effect", "Behavioural Economics", ENDOWMENT),
        ("Queue", "Java Data Structures", QUEUE),
    ],
}


async def main() -> int:
    case_set = sys.argv[sys.argv.index("--set") + 1] if "--set" in sys.argv else "dev"
    if case_set not in SUBJECT_SETS:
        print(f"unknown --set {case_set!r}; choose from {sorted(SUBJECT_SETS)}", file=sys.stderr)
        return 2
    print(f"case set: {case_set}")

    if "--confirm" in sys.argv:
        # Measures the confirmation step, which is off in production
        # (FACT_CHECK_CONFIRM). Set on the agent module: config is bound at import.
        from app.agents import fact_check

        fact_check.FACT_CHECK_CONFIRM = True
        print("confirmation step: ON (measurement only)")

    try:
        client = build_client()
    except ContactNotConfigured as exc:
        print(exc, file=sys.stderr)
        return 2

    results: list[dict] = []

    async with client:
        for topic, field, cases in SUBJECT_SETS[case_set]:
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
                    # Kept whole. At 300 chars the confirmation's part of the
                    # reason - WHICH sentences it compared - was cut off, which
                    # is precisely what diagnosing a wrong verdict needs.
                    "correct": correct, "reason": verdict.reason,
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
    mode = "confirm" if "--confirm" in sys.argv else "default"
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    path = OUT_DIR / f"negative-control-{case_set}-{mode}-{stamp}.json"
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
