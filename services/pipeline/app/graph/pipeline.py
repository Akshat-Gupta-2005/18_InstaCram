"""The pipeline as a LangGraph (W4 task 4b.1).

Five steps and one real branch:

        START
        /   \\                     scrape and data-gen have NO dependency on
    scrape  data-gen              each other, so LangGraph runs them
        \\   /                     concurrently - task 4b.2
         join
          |
      card-gen
          |
     fact-check
        /    \\
    persist   END (empty)

The agents themselves stay plain async functions. The graph orchestrates them; it
does not own them, so each remains runnable and testable on its own, which is what
task 8a asked for and what scripts/run_agents.py still exercises.

THREE WAYS A TOPIC ENDS WITHOUT CARDS, and they are deliberately distinguishable:

  unsourced - no source could ground it. No card is written, because invariant 4
              requires provenance and a card without it must not be servable.
  empty     - drafts existed but none survived fact-check (invariant 6). Reported
              to the user in failed_topics, retried only on a later
              candidate-generation event (P16/P17).
  degraded  - the CHECKER failed, not the cards. Kept separate so a broken
              fact-checker cannot masquerade as a 100% rejection rate and get
              blamed on the generator (P10, P29).
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from dataclasses import field as dc_field
from typing import Any, Literal, TypedDict

import httpx
from langgraph.graph import END, START, StateGraph

from app import metrics
from app.agents.card_gen import Draft, Rejected, SourceText, generate_cards
from app.agents.data_gen import Supplement, generate_supplement
from app.agents.fact_check import Verdict, check_card
from app.agents.scraper import Grounding, default_sources, ground_topic
from app.llm import LLMError
from app.repo.persist import (
    persist_scroll,
    quarantine_draft,
    record_run,
    set_topic_status,
)

Outcome = Literal["ready", "empty", "unsourced", "degraded"]


@dataclass
class Judged:
    draft: Draft
    verdict: Verdict


class PipelineState(TypedDict, total=False):
    # inputs
    topic: str
    field: str
    description: str
    # The topic row this run writes against. Created by the CALLER together with
    # its outbox row (task 4c.4), because that pairing has to be atomic and the
    # graph is not a transaction. Absent when running the graph standalone, in
    # which case nothing is persisted and the run is a dry run.
    topic_id: str
    # step outputs - scrape and data-gen write DISJOINT keys, which is what makes
    # running them concurrently safe without a reducer
    grounding: Grounding
    supplement: Supplement
    drafts: list[Draft]
    malformed: list[Rejected]
    passed: list[Judged]
    failed: list[Judged]
    checker_errors: list[str]
    outcome: Outcome
    note: str


@dataclass
class PipelineResult:
    topic: str
    outcome: Outcome
    note: str = ""
    passed: list[Judged] = dc_field(default_factory=list)
    failed: list[Judged] = dc_field(default_factory=list)
    malformed: list[Rejected] = dc_field(default_factory=list)
    checker_errors: list[str] = dc_field(default_factory=list)
    grounding: Grounding | None = None

    @property
    def drafts_generated(self) -> int:
        return len(self.passed) + len(self.failed) + len(self.checker_errors)


def build_pipeline(client: httpx.AsyncClient, conn: Any | None = None) -> Any:
    """Compiles the graph with its collaborators bound.

    The HTTP client and database connection are closures rather than state,
    because graph state should be data about the run, not live handles - and
    LangGraph may serialise state for checkpointing, which a socket cannot survive.
    """
    sources = default_sources(client)

    async def scrape(state: PipelineState) -> dict[str, Any]:
        grounding = await ground_topic(
            state["topic"], state["field"], sources=sources, conn=conn
        )
        return {"grounding": grounding}

    async def data_gen(state: PipelineState) -> dict[str, Any]:
        supplement = await generate_supplement(
            client, state["topic"], state["description"]
        )
        return {"supplement": supplement}

    async def card_gen(state: PipelineState) -> dict[str, Any]:
        grounding = state["grounding"]
        supplement = state["supplement"]
        drafts, malformed = await generate_cards(
            client,
            topic=state["topic"],
            description=state["description"],
            sources=[SourceText(grounding.text, grounding.source_url)],
            supplement_content=supplement.content,
            supplement_confidence=supplement.confidence,
        )
        return {"drafts": drafts, "malformed": malformed}

    async def fact_check(state: PipelineState) -> dict[str, Any]:
        passed: list[Judged] = []
        failed: list[Judged] = []
        errors: list[str] = []
        grounding = state["grounding"]
        supplement = state["supplement"]

        for draft in state["drafts"]:
            try:
                verdict = await check_card(
                    client,
                    card_content=draft.content,
                    scraped=grounding.text,
                    generated=supplement.content,
                )
            except LLMError as exc:
                # The checker failed, not the card. Counting it as a rejection
                # would let a broken gate quietly empty the corpus while the
                # counters blamed the generator.
                errors.append(str(exc))
                continue
            (passed if verdict.passed else failed).append(Judged(draft, verdict))

        return {"passed": passed, "failed": failed, "checker_errors": errors}

    async def persist(state: PipelineState) -> dict[str, Any]:
        """Tasks 4c.1-4c.3. Cards, quarantine, counters, status.

        The topic's own vector is NOT written here. Its outbox row was committed
        with the topic row before this graph ran, and the worker drains it - so a
        vector write can fail and retry without the topic being lost (§4.6).
        """
        topic_id = state.get("topic_id")
        if conn is None or topic_id is None:
            return {"outcome": "ready", "note": "dry run - nothing persisted"}

        passed = state.get("passed", [])
        failed = state.get("failed", [])

        async with conn.transaction():
            for judged in passed:
                await persist_scroll(conn, topic_id=topic_id, draft=judged.draft)
            for judged in failed:
                await quarantine_draft(
                    conn,
                    topic_id=topic_id,
                    content=judged.draft.content,
                    reason=judged.verdict.reason,
                )
            await record_run(
                conn,
                topic_id=topic_id,
                generated=len(passed) + len(failed),
                passed=len(passed),
                failed=len(failed),
            )
            await set_topic_status(conn, topic_id=topic_id, status="ready")

        return {"outcome": "ready"}

    async def _record_no_cards(state: PipelineState, *, count_drafts: bool) -> None:
        """Shared tail for the three zero-card endings.

        `empty` is not cosmetic: without it a topic whose drafts all failed is
        indistinguishable from a healthy one whose cards have not loaded, AND the
        lookup treats it as a valid cache hit - so the failure is cached and
        served as success forever (P10).
        """
        topic_id = state.get("topic_id")
        if conn is None or topic_id is None:
            return
        failed = state.get("failed", [])
        async with conn.transaction():
            for judged in failed:
                await quarantine_draft(
                    conn,
                    topic_id=topic_id,
                    content=judged.draft.content,
                    reason=judged.verdict.reason,
                )
            await record_run(
                conn,
                topic_id=topic_id,
                generated=len(failed) if count_drafts else 0,
                passed=0,
                failed=len(failed),
            )
            await set_topic_status(conn, topic_id=topic_id, status="empty")

    def after_grounding(state: PipelineState) -> str:
        return "generate" if state["grounding"].ok else "unsourced"

    def after_card_gen(state: PipelineState) -> str:
        return "check" if state["drafts"] else "empty"

    def after_fact_check(state: PipelineState) -> str:
        if state["passed"]:
            return "persist"
        # No card passed. Which kind of nothing this is matters: a checker that
        # errored on every draft is a broken gate, not an unwritable topic.
        return "degraded" if state["checker_errors"] and not state["failed"] else "empty"

    async def join(state: PipelineState) -> dict[str, Any]:
        """Does nothing, and is load-bearing anyway.

        LangGraph triggers a node when ANY incoming edge fires, not when all of
        them do. With the branch hanging off `scrape` directly, routing to
        `unsourced` did not stop `data_gen`'s edge from firing `card_gen` - so an
        ungrounded topic still produced cards, from supplementary material with
        no source, and reported itself `ready`. That is invariant 4 violated by
        orchestration rather than by any agent.

        Both branches meet here first, so the conditional below is the ONLY path
        into card generation and there is nothing left to fire it independently.
        """
        return {}

    async def unsourced(state: PipelineState) -> dict[str, Any]:
        # Marked `empty` so the lookup treats it as a miss and a later run can
        # retry it - a source that does not exist today may exist tomorrow, and
        # adding the Javadoc source already turned four of these into successes.
        await _record_no_cards(state, count_drafts=False)
        return {"outcome": "unsourced", "note": state["grounding"].reason}

    async def empty(state: PipelineState) -> dict[str, Any]:
        await _record_no_cards(state, count_drafts=True)
        return {"outcome": "empty", "note": "no draft survived fact-check"}

    async def degraded(state: PipelineState) -> dict[str, Any]:
        # Deliberately NOT persisted as `empty`, and the drafts are NOT
        # quarantined. The checker failed, not the cards. Recording this as a
        # 100% rejection rate would send someone to fix the generator, and
        # marking the topic empty would discard work that was probably fine. The
        # topic stays `pending` so the next run reconsiders it.
        return {
            "outcome": "degraded",
            "note": f"the fact-checker failed on every draft: {state['checker_errors'][0]}",
        }

    graph = StateGraph(PipelineState)
    graph.add_node("scrape", scrape)
    graph.add_node("data_gen", data_gen)
    graph.add_node("join", join)
    graph.add_node("card_gen", card_gen)
    graph.add_node("fact_check", fact_check)
    graph.add_node("persist", persist)
    graph.add_node("unsourced", unsourced)
    graph.add_node("empty", empty)
    graph.add_node("degraded", degraded)

    # Two edges out of START is what makes these two run concurrently.
    graph.add_edge(START, "scrape")
    graph.add_edge(START, "data_gen")

    # Both branches meet at `join` before anything branches. Putting the
    # conditional on `scrape` instead looks equivalent and is not: data_gen's
    # edge would still fire card_gen independently. See join()'s docstring.
    graph.add_edge("scrape", "join")
    graph.add_edge("data_gen", "join")
    graph.add_conditional_edges(
        "join", after_grounding, {"generate": "card_gen", "unsourced": "unsourced"}
    )

    graph.add_conditional_edges(
        "card_gen", after_card_gen, {"check": "fact_check", "empty": "empty"}
    )
    graph.add_conditional_edges(
        "fact_check",
        after_fact_check,
        {"persist": "persist", "empty": "empty", "degraded": "degraded"},
    )

    for terminal in ("persist", "unsourced", "empty", "degraded"):
        graph.add_edge(terminal, END)

    return graph.compile()


async def run_topic(
    client: httpx.AsyncClient,
    *,
    topic: str,
    field: str,
    description: str,
    conn: Any | None = None,
    topic_id: str | None = None,
) -> PipelineResult:
    """Runs one topic. Persists only when given BOTH a connection and a topic_id.

    Without them the run is a dry run: everything is generated and checked, and
    nothing is written. That is what keeps the graph runnable standalone, which
    is how scripts/run_pipeline.py exercises orchestration without touching the
    database.
    """
    app = build_pipeline(client, conn)
    inputs: dict[str, Any] = {"topic": topic, "field": field, "description": description}
    if topic_id is not None:
        inputs["topic_id"] = topic_id

    started = time.monotonic()
    state: PipelineState = await app.ainvoke(inputs)
    metrics.topic_duration.observe(time.monotonic() - started)
    result = PipelineResult(
        topic=topic,
        outcome=state.get("outcome", "empty"),
        note=state.get("note", ""),
        passed=state.get("passed", []),
        failed=state.get("failed", []),
        malformed=state.get("malformed", []),
        checker_errors=state.get("checker_errors", []),
        grounding=state.get("grounding"),
    )

    # Counted here rather than inside each node, so there is one place where the
    # numbers are produced and the nodes stay about persistence. `failed` and
    # `checker_errors` are counted SEPARATELY and never summed: a rejected draft
    # and a broken checker look identical in a single failure count, and they
    # need opposite responses (P10, P29).
    metrics.drafts_generated.inc(result.drafts_generated)
    metrics.drafts_passed.inc(len(result.passed))
    metrics.drafts_failed.inc(len(result.failed))
    metrics.checker_errors.inc(len(result.checker_errors))
    metrics.topics_completed.labels(outcome=result.outcome).inc()

    return result
