"""The pipeline graph, with every agent stubbed.

No network, no model, no database. What is being tested is the ORCHESTRATION:
that the two independent steps really run concurrently, that the branch goes
where it should, and - the one that matters most - that a topic ending with no
cards is distinguishable by REASON. "unsourced", "empty" and "degraded" all
produce zero cards and mean completely different things.
"""

from __future__ import annotations

import asyncio

import pytest

from app.agents.card_gen import Draft, Rejected
from app.agents.data_gen import Supplement
from app.agents.fact_check import Verdict
from app.agents.scraper import Grounding
from app.graph import pipeline as mod
from app.llm import LLMError

GOOD_GROUNDING = Grounding(
    topic="HashMap", field="Java Collections", ok=True, reason="exact",
    text="x" * 2000, source_url="https://example.com/HashMap",
    source_name="javadoc", matched_title="java.util.HashMap",
)
NO_GROUNDING = Grounding(
    topic="Obscure", field="Nowhere", ok=False,
    reason="no source could ground it", source_name="javadoc",
)
SUPPLEMENT = Supplement(content="supplementary material", confidence="high")


def a_draft(n: int = 1) -> Draft:
    return Draft(
        content=f"card {n}", source_url="https://example.com/HashMap",
        trust_label="sourced_verified", why_it_matters="because",
        recall_prompt="q?", recall_answer="a.",
    )


@pytest.fixture
def stub(monkeypatch: pytest.MonkeyPatch):
    """Replaces every agent. Each call is recorded so the test can assert which
    steps ran - the point of several cases below is that a step did NOT run."""
    calls: list[str] = []

    async def ground(topic, field, *, sources, conn=None):
        calls.append("scrape")
        await asyncio.sleep(0.05)
        return GOOD_GROUNDING

    async def supplement(client, topic, description):
        calls.append("data_gen")
        await asyncio.sleep(0.05)
        return SUPPLEMENT

    async def cards(client, **kwargs):
        calls.append("card_gen")
        return [a_draft(1), a_draft(2)], []

    async def check(client, **kwargs):
        calls.append("fact_check")
        return Verdict(passed=True, reason="looks right", failed_claim=None)

    monkeypatch.setattr(mod, "ground_topic", ground)
    monkeypatch.setattr(mod, "generate_supplement", supplement)
    monkeypatch.setattr(mod, "generate_cards", cards)
    monkeypatch.setattr(mod, "check_card", check)
    monkeypatch.setattr(mod, "default_sources", lambda client: [])
    return calls


async def run(**kw):
    return await mod.run_topic(
        client=None,  # type: ignore[arg-type]
        topic=kw.get("topic", "HashMap"),
        field="Java Collections",
        description="the hash-table backed Map",
    )


async def test_happy_path_reaches_persist(stub) -> None:
    result = await run()
    assert result.outcome == "ready"
    assert len(result.passed) == 2
    assert not result.failed


async def test_scrape_and_data_gen_run_concurrently(stub) -> None:
    """Both stubs sleep 50ms. Sequential would take >=100ms; concurrent well under.

    This is task 4b.2's assertion, and it is why the two steps hang off START
    separately instead of one feeding the other.
    """
    started = asyncio.get_event_loop().time()
    await run()
    elapsed = asyncio.get_event_loop().time() - started
    assert elapsed < 0.09, f"steps appear sequential: {elapsed:.3f}s"
    assert {"scrape", "data_gen"} <= set(stub)


async def test_unsourced_topic_never_reaches_card_generation(
    stub, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The important one. Invariant 4 says a card with no provenance must not be
    servable, so a topic with no grounding must not be written AT ALL - not
    written and then filtered. If data-gen's edge alone could trigger card_gen,
    the graph would generate cards from supplementary material with no source."""

    async def ground(topic, field, *, sources, conn=None):
        stub.append("scrape")
        return NO_GROUNDING

    monkeypatch.setattr(mod, "ground_topic", ground)
    result = await run()

    assert result.outcome == "unsourced"
    assert "card_gen" not in stub, "card generation ran despite there being no source"
    assert "fact_check" not in stub


async def test_no_drafts_ends_empty(stub, monkeypatch: pytest.MonkeyPatch) -> None:
    async def cards(client, **kwargs):
        stub.append("card_gen")
        return [], [Rejected({}, "missing content")]

    monkeypatch.setattr(mod, "generate_cards", cards)
    result = await run()
    assert result.outcome == "empty"
    assert "fact_check" not in stub


async def test_all_drafts_rejected_ends_empty(stub, monkeypatch: pytest.MonkeyPatch) -> None:
    async def check(client, **kwargs):
        stub.append("fact_check")
        return Verdict(passed=False, reason="claim unsupported", failed_claim="O(1) always")

    monkeypatch.setattr(mod, "check_card", check)
    result = await run()
    assert result.outcome == "empty"
    assert len(result.failed) == 2
    assert result.failed[0].verdict.failed_claim == "O(1) always"


async def test_a_broken_checker_is_degraded_not_empty(
    stub, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A checker erroring on every draft is a broken gate, not an unwritable
    topic. Collapsing the two would report a 100% rejection rate and send someone
    to fix the generator (P10, P29)."""

    async def check(client, **kwargs):
        stub.append("fact_check")
        raise LLMError("unusable verdict: ''")

    monkeypatch.setattr(mod, "check_card", check)
    result = await run()

    assert result.outcome == "degraded"
    assert not result.failed, "checker errors must not be counted as rejections"
    assert len(result.checker_errors) == 2


async def test_a_mixed_run_keeps_both_sides(stub, monkeypatch: pytest.MonkeyPatch) -> None:
    verdicts = iter(
        [
            Verdict(passed=True, reason="ok", failed_claim=None),
            Verdict(passed=False, reason="wrong bound", failed_claim="O(1) worst case"),
        ]
    )

    async def check(client, **kwargs):
        return next(verdicts)

    monkeypatch.setattr(mod, "check_card", check)
    result = await run()

    assert result.outcome == "ready"
    assert len(result.passed) == 1
    assert len(result.failed) == 1
    assert result.drafts_generated == 2
