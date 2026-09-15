"""Fact-Check Agent (W4 task 4a.4). The sole quality gate.

Nothing reaches a user without passing here, and in v1 a failure is permanent -
the draft is quarantined and never retried. So the cost of a FALSE REJECT is a
card that is silently never written, and if every draft for a topic fails, the
topic ends up status='empty' and is never served.

That asymmetry is why the verdict is read strictly but the failure path is
generous: anything that is not an explicit, well-formed "fail" is treated as a
pass being unavailable rather than as a rejection. A checker that errors must not
quietly empty the corpus - an unparseable response raises, and the caller decides,
instead of being silently counted as a rejection.

`reason` and `failed_claim` are carried into the quarantine table because an
over-strict checker and a weak generator produce the IDENTICAL rejection rate,
and only the text separates them (P10).
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.llm import LLMError, complete_json
from app.prompts import load_prompt, render

PROMPT_FILE = "fact-check.md"


@dataclass(frozen=True)
class Verdict:
    passed: bool
    reason: str
    failed_claim: str | None

    @property
    def label(self) -> str:
        return "pass" if self.passed else "fail"


async def check_card(
    client: httpx.AsyncClient,
    *,
    card_content: str,
    scraped: str,
    generated: str,
) -> Verdict:
    prompt = render(
        load_prompt(PROMPT_FILE),
        card_content=card_content,
        scraped=scraped or "(no source material was available)",
        generated=generated or "(none)",
    )
    data = await complete_json(client, prompt, max_tokens=800)

    if not isinstance(data, dict):
        raise LLMError(f"fact-check returned {type(data).__name__}, expected an object")

    raw_verdict = str(data.get("verdict", "")).strip().lower()
    if raw_verdict not in ("pass", "fail"):
        # Not treated as a rejection. An unrecognised verdict is the checker
        # failing, not the card, and defaulting to "fail" would let a broken
        # checker empty the corpus with nothing reporting why.
        raise LLMError(f"fact-check returned an unusable verdict: {raw_verdict!r}")

    passed = raw_verdict == "pass"
    reason = str(data.get("reason", "")).strip()
    claim = str(data.get("failed_claim") or "").strip() or None

    if not passed and not reason:
        reason = "rejected without a stated reason"

    return Verdict(passed=passed, reason=reason, failed_claim=claim)
