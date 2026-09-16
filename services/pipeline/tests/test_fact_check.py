"""How chunk verdicts are combined into one decision about a card.

This logic is where chunked checking can go wrong in a way that looks fine: too
eager and it rejects cards on silence (no retry exists, so each one is a card
never written), too timid and it passes cards nothing ever corroborated. The
model calls are stubbed because what is under test is the RULE, not the model.

Live behaviour is measured separately by scripts/negative_control.py, which plants
known-false claims and checks the gate catches them.
"""

from __future__ import annotations

import re

import pytest

from app.agents import fact_check
from app.agents.fact_check import check_card
from app.llm import LLMError

CARD = "HashMap offers constant-time performance for get and put."

# Long enough to split several ways once the budget is shrunk by the fixture.
LONG_SOURCE = "A sentence about the subject. " * 40

PASS = {"verdict": "pass", "reason": "checked against the source", "failed_claim": None}
FAIL = {"verdict": "fail", "reason": "contradicts the source", "failed_claim": "constant-time"}

SUPPORTED = {"verdict": "supported", "reason": "the excerpt states this", "failed_claim": None}
NOT_COVERED = {"verdict": "not_covered", "reason": "about something else", "failed_claim": None}
CONTRADICTED = {
    "verdict": "contradicted",
    "reason": "the excerpt says O(log n)",
    "failed_claim": "constant-time performance",
}

# The chunk prompt's excerpt heading. Matched as a pattern rather than by the
# bare word, which also appears in the instructions ABOVE the card.
EXCERPT_HEADING = re.compile(r"EXCERPT \d+ OF \d+:")


class Stub:
    """Replies to chunk calls and single-pass calls from separate queues.

    Dispatching on the prompt matters: a test that queues replies positionally
    breaks whenever the chunk count changes, which made earlier versions of these
    tests fail for reasons that had nothing to do with the rule under test.
    `repeat` supplies every chunk call after the queued ones, so a test says how
    many verdicts it cares about rather than how many chunks the splitter made.
    """

    def __init__(self, *chunks: object, repeat: object = None, whole: list | None = None) -> None:
        self.chunk_queue = list(chunks)
        self.repeat = repeat
        self.whole_queue = list(whole or [])
        self.prompts: list[str] = []

    async def __call__(self, _client, prompt, **_kw):
        self.prompts.append(prompt)
        is_chunk = bool(EXCERPT_HEADING.search(prompt))
        queue = self.chunk_queue if is_chunk else self.whole_queue

        if queue:
            reply = queue.pop(0)
        elif is_chunk and self.repeat is not None:
            reply = self.repeat
        else:
            kind = "chunk" if is_chunk else "single-pass"
            raise AssertionError(f"unexpected {kind} call - the test queued no reply for it")

        if isinstance(reply, Exception):
            raise reply
        return reply

    @property
    def calls(self) -> int:
        return len(self.prompts)

    @property
    def chunk_calls(self) -> int:
        return sum(1 for p in self.prompts if EXCERPT_HEADING.search(p))


@pytest.fixture
def small_chunks(monkeypatch):
    """Shrinks the budget so a short test fixture counts as a long source.

    Patched on the AGENT, not on app.config: the value is bound at import, so
    patching the config module would change nothing and the test would silently
    exercise the single-pass path instead.
    """
    monkeypatch.setattr(fact_check, "FACT_CHECK_SINGLE_PASS_CHARS", 100)
    monkeypatch.setattr(fact_check, "FACT_CHECK_CHUNK_CHARS", 100)
    monkeypatch.setattr(fact_check, "FACT_CHECK_CHUNK_OVERLAP", 10)


def use(monkeypatch, stub: Stub) -> Stub:
    monkeypatch.setattr(fact_check, "complete_json", stub)
    return stub


async def check(scraped: str, generated: str = "") -> fact_check.Verdict:
    return await check_card(
        None, card_content=CARD, scraped=scraped, generated=generated
    )


# --------------------------------------------------------------- single pass

@pytest.mark.asyncio
async def test_a_short_source_takes_the_single_pass_path(monkeypatch) -> None:
    stub = use(monkeypatch, Stub(whole=[PASS]))
    verdict = await check("a short source")
    assert verdict.passed
    assert verdict.chunks_checked == 1
    assert stub.chunk_calls == 0


@pytest.mark.asyncio
async def test_single_pass_failure_is_a_rejection(monkeypatch) -> None:
    use(monkeypatch, Stub(whole=[FAIL]))
    verdict = await check("a short source")
    assert not verdict.passed
    assert verdict.failed_claim == "constant-time"


@pytest.mark.asyncio
async def test_an_unusable_verdict_raises_rather_than_rejecting(monkeypatch) -> None:
    """A broken checker must not be able to empty the corpus quietly."""
    use(monkeypatch, Stub(whole=[{"verdict": "maybe", "reason": "unsure"}]))
    with pytest.raises(LLMError, match="unusable verdict"):
        await check("a short source")


@pytest.mark.asyncio
async def test_a_source_that_fits_one_call_is_not_chunked(monkeypatch) -> None:
    """The two budgets are separate on purpose. A 4.7k-char Javadoc page fits one
    call and is verified to work that way, so the smaller EXCERPT size must not
    drag it onto the chunked path."""
    monkeypatch.setattr(fact_check, "FACT_CHECK_SINGLE_PASS_CHARS", 10_000)
    monkeypatch.setattr(fact_check, "FACT_CHECK_CHUNK_CHARS", 4_000)
    stub = use(monkeypatch, Stub(whole=[PASS]))
    verdict = await check("x" * 4_768)
    assert verdict.passed
    assert stub.chunk_calls == 0


# ------------------------------------------------------------------ chunked

@pytest.mark.asyncio
async def test_a_long_source_is_chunked(small_chunks, monkeypatch) -> None:
    stub = use(monkeypatch, Stub(SUPPORTED, repeat=NOT_COVERED))
    verdict = await check(LONG_SOURCE)
    assert verdict.passed
    assert stub.chunk_calls > 1
    assert verdict.chunks_checked > 1


@pytest.mark.asyncio
async def test_one_contradiction_rejects_the_card(small_chunks, monkeypatch) -> None:
    use(monkeypatch, Stub(NOT_COVERED, CONTRADICTED, repeat=SUPPORTED))
    verdict = await check(LONG_SOURCE)
    assert not verdict.passed
    assert verdict.failed_claim == "constant-time performance"
    assert "excerpt 2" in verdict.reason


@pytest.mark.asyncio
async def test_a_contradiction_stops_further_calls(small_chunks, monkeypatch) -> None:
    """Every remaining call costs the same and none can change the outcome."""
    stub = use(monkeypatch, Stub(CONTRADICTED, repeat=SUPPORTED))
    await check(LONG_SOURCE)
    assert stub.calls == 1


@pytest.mark.asyncio
async def test_silence_alone_never_rejects(small_chunks, monkeypatch) -> None:
    """THE property that makes chunked checking safe.

    Every excerpt saying "not covered" is what a fragment says about almost every
    claim, so it must not be a rejection - it falls back to the single-pass gate
    over the slice the generator actually wrote from.
    """
    stub = use(monkeypatch, Stub(repeat=NOT_COVERED, whole=[PASS]))
    verdict = await check(LONG_SOURCE)
    assert verdict.passed
    assert not EXCERPT_HEADING.search(stub.prompts[-1])


@pytest.mark.asyncio
async def test_the_fallback_can_still_reject(small_chunks, monkeypatch) -> None:
    stub = use(monkeypatch, Stub(repeat=NOT_COVERED, whole=[FAIL]))
    verdict = await check(LONG_SOURCE)
    assert not verdict.passed
    assert not EXCERPT_HEADING.search(stub.prompts[-1])


@pytest.mark.asyncio
async def test_the_fallback_sees_only_the_slice_the_generator_used(
    small_chunks, monkeypatch
) -> None:
    """It must be small enough to fit the window, or the fallback reproduces the
    very overflow that chunking exists to avoid."""
    monkeypatch.setattr(fact_check, "SCRAPE_CHAR_BUDGET", 120)
    stub = use(monkeypatch, Stub(repeat=NOT_COVERED, whole=[PASS]))
    await check(LONG_SOURCE)
    assert LONG_SOURCE not in stub.prompts[-1]
    assert LONG_SOURCE[:120] in stub.prompts[-1]


@pytest.mark.asyncio
async def test_corroboration_outranks_a_chunk_that_errored(small_chunks, monkeypatch) -> None:
    """One failed call is not evidence against a card that another call confirmed."""
    use(monkeypatch, Stub(LLMError("gateway timeout"), SUPPORTED, repeat=NOT_COVERED))
    verdict = await check(LONG_SOURCE)
    assert verdict.passed


@pytest.mark.asyncio
async def test_a_contradiction_outranks_an_earlier_error(small_chunks, monkeypatch) -> None:
    use(monkeypatch, Stub(LLMError("gateway timeout"), CONTRADICTED, repeat=SUPPORTED))
    verdict = await check(LONG_SOURCE)
    assert not verdict.passed


@pytest.mark.asyncio
async def test_errors_with_nothing_corroborating_raise(small_chunks, monkeypatch) -> None:
    """Passing here would mean passing a card on the strength of calls that
    failed. The caller decides, exactly as on the single-pass path."""
    use(monkeypatch, Stub(repeat=LLMError("gateway timeout")))
    with pytest.raises(LLMError, match="gateway timeout"):
        await check(LONG_SOURCE)


@pytest.mark.asyncio
async def test_an_unusable_chunk_verdict_does_not_become_a_rejection(
    small_chunks, monkeypatch
) -> None:
    stub = use(monkeypatch, Stub({"verdict": "probably fine", "reason": "x"}, SUPPORTED,
                                 repeat=NOT_COVERED))
    verdict = await check(LONG_SOURCE)
    assert verdict.passed
    assert stub.calls >= 2


@pytest.mark.asyncio
async def test_the_card_precedes_the_excerpt_in_every_chunk_prompt(
    small_chunks, monkeypatch
) -> None:
    """Ollama truncates an over-long prompt from the FRONT. If the budget is ever
    miscalculated, what is lost must not be the thing being judged."""
    stub = use(monkeypatch, Stub(repeat=NOT_COVERED, whole=[PASS]))
    await check(LONG_SOURCE)
    chunk_prompts = [p for p in stub.prompts if EXCERPT_HEADING.search(p)]
    assert chunk_prompts
    for prompt in chunk_prompts:
        heading = EXCERPT_HEADING.search(prompt)
        assert prompt.index(CARD) < heading.start()
