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

TWO PATHS, chosen by how long the source material is (P33). A source that fits
one context window is checked in a single call, exactly as before. A longer one
is checked chunk by chunk, because the alternative is not "a slower check" but
"no check at all": Ollama silently truncates an over-long prompt FROM THE FRONT,
and the front of this prompt is the card. Measured, the gate caught 4/4 planted
errors against a 4.7k-char source and 0/3 against a 32k one, reporting that the
card "does not contain any specific factual claims" - it was reading source text
with no card attached and answering anyway.

The chunk pass uses a DIFFERENT prompt, not this one in a loop. See
prompts/fact-check-chunk.md: absence of a claim from one fragment is not evidence
against it, and a single-pass prompt run per-chunk would reject nearly everything.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.chunking import split
from app.config import (
    FACT_CHECK_CHUNK_CHARS,
    FACT_CHECK_CHUNK_OVERLAP,
    FACT_CHECK_SINGLE_PASS_CHARS,
    SCRAPE_CHAR_BUDGET,
)
from app.llm import LLMError, complete_json
from app.prompts import load_prompt, render

PROMPT_FILE = "fact-check.md"
CHUNK_PROMPT_FILE = "fact-check-chunk.md"

CHUNK_VERDICTS = frozenset({"contradicted", "supported", "not_covered"})


@dataclass(frozen=True)
class Verdict:
    passed: bool
    reason: str
    failed_claim: str | None
    # How many model calls judged this card. 1 is the single-pass path. Recorded
    # because "the gate passed it" and "the gate never saw it" are the same row
    # otherwise, which is precisely how P33 stayed hidden through a whole
    # measurement run.
    chunks_checked: int = 1

    @property
    def label(self) -> str:
        return "pass" if self.passed else "fail"


@dataclass(frozen=True)
class ChunkVerdict:
    verdict: str
    reason: str
    failed_claim: str | None

    @property
    def contradicts(self) -> bool:
        return self.verdict == "contradicted"


def _budget(model: str) -> int:
    # Reasoning needs room beyond the answer, so the thinking arm gets a larger
    # budget. P23's failure was exactly this: reasoning consumed the whole budget
    # and the reply came back EMPTY.
    return 2000 if model == "thinking" else 800


async def check_card(
    client: httpx.AsyncClient,
    *,
    card_content: str,
    scraped: str,
    generated: str,
    model: str = "default",
) -> Verdict:
    """`model` exists so 8d can route the SAME check through the `thinking`
    gateway entry and compare verdicts. Production always uses the default; the
    thinking entry is a measurement instrument, not a fallback."""
    # Two numbers, not one: what fits in a single call is larger than what makes
    # a good excerpt. Dispatching on the chunk size instead would push short
    # Javadoc sources - already verified at 4/4 single-pass - onto the chunked
    # path for no reason.
    if len(scraped) <= FACT_CHECK_SINGLE_PASS_CHARS:
        return await _check_whole(
            client, card_content=card_content, scraped=scraped,
            generated=generated, model=model,
        )
    return await _check_chunked(
        client, card_content=card_content, scraped=scraped,
        generated=generated, model=model,
    )


async def _check_whole(
    client: httpx.AsyncClient,
    *,
    card_content: str,
    scraped: str,
    generated: str,
    model: str,
    chunks_checked: int = 1,
) -> Verdict:
    prompt = render(
        load_prompt(PROMPT_FILE),
        card_content=card_content,
        scraped=scraped or "(no source material was available)",
        generated=generated or "(none)",
    )
    data = await complete_json(client, prompt, max_tokens=_budget(model), model=model)

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

    return Verdict(
        passed=passed, reason=reason, failed_claim=claim, chunks_checked=chunks_checked
    )


async def _check_chunked(
    client: httpx.AsyncClient,
    *,
    card_content: str,
    scraped: str,
    generated: str,
    model: str,
) -> Verdict:
    chunks = split(
        scraped, size=FACT_CHECK_CHUNK_CHARS, overlap=FACT_CHECK_CHUNK_OVERLAP
    )
    total = len(chunks)

    supported: list[ChunkVerdict] = []
    errors: list[str] = []

    for i, chunk in enumerate(chunks, start=1):
        try:
            result = await _check_chunk(
                client, card_content=card_content, excerpt=chunk,
                part=i, total=total, model=model,
            )
        except LLMError as exc:
            # Held, not raised yet. A later chunk may find a contradiction, and
            # positive evidence of a false claim outranks one chunk that failed
            # to answer.
            errors.append(f"excerpt {i}/{total}: {exc}")
            continue

        if result.contradicts:
            # Decisive on its own, so stop: every further call costs the same as
            # this one and cannot change the outcome.
            return Verdict(
                passed=False,
                reason=f"excerpt {i} of {total} contradicts the card: {result.reason}",
                failed_claim=result.failed_claim,
                chunks_checked=i,
            )
        if result.verdict == "supported":
            supported.append(result)

    if errors and not supported:
        # Nothing corroborated the card AND the checker was partly broken. Passing
        # here would mean passing a card on the strength of calls that failed.
        raise LLMError("; ".join(errors))

    if supported:
        return Verdict(
            passed=True,
            reason=(
                f"no contradiction found across {total} excerpts of the source; "
                f"{len(supported)} corroborated it - {supported[0].reason}"
            ),
            failed_claim=None,
            chunks_checked=total,
        )

    # Every excerpt said "not covered": no part of the source speaks to this card
    # at all. That is suspicious - the card was written FROM this source - but it
    # is not a contradiction, and rejecting on it would mean rejecting on silence.
    # So it falls back to the single-pass gate over the slice the generator
    # actually used, which is the material the card should be traceable to and is
    # small enough to fit. That path can also weigh the model's own knowledge,
    # which the chunk prompt deliberately forbids.
    return await _check_whole(
        client,
        card_content=card_content,
        scraped=scraped[:SCRAPE_CHAR_BUDGET],
        generated=generated,
        model=model,
        chunks_checked=total + 1,
    )


async def _check_chunk(
    client: httpx.AsyncClient,
    *,
    card_content: str,
    excerpt: str,
    part: int,
    total: int,
    model: str,
) -> ChunkVerdict:
    prompt = render(
        load_prompt(CHUNK_PROMPT_FILE),
        card_content=card_content,
        excerpt=excerpt,
        part=str(part),
        total=str(total),
    )
    data = await complete_json(client, prompt, max_tokens=_budget(model), model=model)

    if not isinstance(data, dict):
        raise LLMError(f"chunk check returned {type(data).__name__}, expected an object")

    raw = str(data.get("verdict", "")).strip().lower()
    if raw not in CHUNK_VERDICTS:
        raise LLMError(f"chunk check returned an unusable verdict: {raw!r}")

    return ChunkVerdict(
        verdict=raw,
        reason=str(data.get("reason", "")).strip() or "no reason given",
        failed_claim=str(data.get("failed_claim") or "").strip() or None,
    )
