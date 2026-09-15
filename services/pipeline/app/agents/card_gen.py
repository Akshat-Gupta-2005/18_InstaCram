"""Card Generation LLM (W4 task 4a.3).

Grounding + supplementary material -> 2-4 draft cards for one topic.

Every field of a draft is validated here rather than at the database. The schema
is the backstop (source_url NOT NULL, trust_label CHECK), but a card rejected by
Postgres arrives as a constraint violation that names a column, when what the
quarantine needs is a reason a human can read. Validating here also means an
invalid card is quarantined like any other rejection instead of crashing a run.

Invariant 4 - a card with no provenance must not be servable - is enforced as a
hard requirement: a draft with no source_url is dropped, never repaired by
substituting a placeholder.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.config import SCRAPE_CHAR_BUDGET
from app.llm import LLMError, complete_json
from app.prompts import load_prompt, render

PROMPT_FILE = "card-generation.md"

TRUST_LABELS = frozenset({"sourced_verified", "ai_generated"})


@dataclass(frozen=True)
class SourceText:
    text: str
    source_url: str


@dataclass(frozen=True)
class Draft:
    content: str
    source_url: str
    trust_label: str
    why_it_matters: str
    recall_prompt: str
    recall_answer: str


@dataclass(frozen=True)
class Rejected:
    """A draft the generator returned that cannot become a card.

    Kept rather than silently dropped: an agent producing malformed drafts and a
    fact-checker rejecting good ones look identical in a count, and only the text
    tells them apart (P10).
    """

    raw: dict[str, object]
    reason: str


def format_sources(sources: list[SourceText]) -> str:
    """Numbered, URL-labelled, and truncated to the per-source budget.

    The URL is printed with each block because the prompt asks the model to pick
    the URL that supports each card - it cannot do that if the material arrives
    as one anonymous wall of text.
    """
    blocks = []
    for i, s in enumerate(sources, start=1):
        body = s.text[:SCRAPE_CHAR_BUDGET]
        if len(s.text) > SCRAPE_CHAR_BUDGET:
            body += "\n[...truncated]"
        blocks.append(f"[{i}] SOURCE URL: {s.source_url}\n{body}")
    return "\n\n".join(blocks) if blocks else "(none)"


def _validate(raw: object, allowed_urls: frozenset[str]) -> Draft | Rejected:
    if not isinstance(raw, dict):
        return Rejected({}, f"draft was {type(raw).__name__}, expected an object")

    fields = {
        k: str(raw.get(k, "")).strip()
        for k in (
            "content",
            "source_url",
            "trust_label",
            "why_it_matters",
            "recall_prompt",
            "recall_answer",
        )
    }

    missing = [k for k, v in fields.items() if not v]
    if missing:
        return Rejected(raw, f"draft is missing required field(s): {', '.join(missing)}")

    if fields["trust_label"] not in TRUST_LABELS:
        return Rejected(raw, f"trust_label {fields['trust_label']!r} is not a valid value")

    # Invariant 4. A hallucinated URL is worse than no card: it looks like
    # provenance, and the user's only way to check a fact is that link.
    if fields["source_url"] not in allowed_urls:
        return Rejected(
            raw,
            f"source_url {fields['source_url']!r} was not among the URLs supplied "
            "to the generator, so it cannot be verified",
        )

    return Draft(**fields)  # type: ignore[arg-type]


async def generate_cards(
    client: httpx.AsyncClient,
    *,
    topic: str,
    description: str,
    sources: list[SourceText],
    supplement_content: str,
    supplement_confidence: str,
) -> tuple[list[Draft], list[Rejected]]:
    prompt = render(
        load_prompt(PROMPT_FILE),
        topic_name=topic,
        topic_description=description,
        scraped=format_sources(sources),
        generated=supplement_content,
        confidence=supplement_confidence,
    )
    data = await complete_json(client, prompt, max_tokens=3000)

    if not isinstance(data, dict) or not isinstance(data.get("cards"), list):
        raise LLMError("card generator did not return a 'cards' array")

    allowed = frozenset(s.source_url for s in sources)
    drafts: list[Draft] = []
    rejected: list[Rejected] = []

    for raw in data["cards"]:
        result = _validate(raw, allowed)
        if isinstance(result, Draft):
            drafts.append(result)
        else:
            rejected.append(result)

    return drafts, rejected
