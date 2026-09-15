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

from dataclasses import dataclass
from dataclasses import field as dc_field
from typing import Any, Literal, TypedDict

import httpx
from langgraph.graph import END, START, StateGraph

from app.agents.card_gen import Draft, Rejected, SourceText, generate_cards
from app.agents.data_gen import Supplement, generate_supplement
from app.agents.fact_check import Verdict, check_card
from app.agents.scraper import Grounding, default_sources, ground_topic
from app.llm import LLMError

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
        # Task 8c fills this in: scroll rows + outbox in one transaction,
        # quarantine rows for failures, and the per-topic counters.
        return {"outcome": "ready"}

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
        return {"outcome": "unsourced", "note": state["grounding"].reason}

    async def empty(state: PipelineState) -> dict[str, Any]:
        return {"outcome": "empty", "note": "no draft survived fact-check"}

    async def degraded(state: PipelineState) -> dict[str, Any]:
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
) -> PipelineResult:
    app = build_pipeline(client, conn)
    state: PipelineState = await app.ainvoke(
        {"topic": topic, "field": field, "description": description}
    )
    return PipelineResult(
        topic=topic,
        outcome=state.get("outcome", "empty"),
        note=state.get("note", ""),
        passed=state.get("passed", []),
        failed=state.get("failed", []),
        malformed=state.get("malformed", []),
        checker_errors=state.get("checker_errors", []),
        grounding=state.get("grounding"),
    )
