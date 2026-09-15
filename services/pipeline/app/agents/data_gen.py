"""LLM Data-Generation Agent (W4 task 4a.2).

Topic name + description -> supplementary reference material.

Runs CONCURRENTLY with the scraper and has no dependency on it, which is the
parallelism the pipeline's split exists to exploit (4b.2). It fills gaps the
scrape misses: a topic whose sources are thin, paywalled, or all written for one
narrow audience.

This is NOT a replacement for grounding. Invariant 4 requires every persisted
card to carry a source_url, so generated material supplements a source, it never
stands in for one - that is the mechanism making the trust claim real rather than
aspirational (BUILD-PLAN §3.2).
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.llm import LLMError, complete_json
from app.prompts import load_prompt, render

PROMPT_FILE = "data-generation.md"


@dataclass(frozen=True)
class Supplement:
    content: str
    confidence: str  # "high" | "low"

    @property
    def is_low_confidence(self) -> bool:
        return self.confidence != "high"


async def generate_supplement(
    client: httpx.AsyncClient, topic: str, description: str
) -> Supplement:
    """Returns the model's own reference material plus its self-reported confidence.

    The confidence field lets the card generator weight sources rather than
    treating scraped and generated material as equivalent. A model's self-report
    is a weak signal, but it is free, and the fact-check gate stands behind it
    either way.
    """
    prompt = render(
        load_prompt(PROMPT_FILE), topic_name=topic, topic_description=description
    )
    data = await complete_json(client, prompt, max_tokens=1200)

    if not isinstance(data, dict):
        raise LLMError(f"data-gen returned {type(data).__name__}, expected an object")

    content = str(data.get("content", "")).strip()
    if not content:
        raise LLMError("data-gen returned no content")

    # Anything that is not exactly "high" is treated as low. A model inventing a
    # third value must not read as confident by accident.
    confidence = "high" if str(data.get("confidence", "")).lower() == "high" else "low"
    return Supplement(content=content, confidence=confidence)
