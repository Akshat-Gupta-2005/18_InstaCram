"""The prompt loader, run against the REAL prompt files.

Deliberately not fixtures. These files are the agents' behaviour, so a change
that breaks the "## Prompt" structure should fail here rather than at the first
live run.
"""

from __future__ import annotations

import pytest

from app.prompts import load_prompt, render

AGENT_PROMPTS = [
    "data-generation.md",
    "card-generation.md",
    "fact-check.md",
    "candidate-topics.md",
]


@pytest.mark.parametrize("file", AGENT_PROMPTS)
def test_every_agent_prompt_loads(file: str) -> None:
    assert load_prompt(file).strip()


@pytest.mark.parametrize("file", AGENT_PROMPTS)
def test_human_reasoning_never_reaches_the_model(file: str) -> None:
    """Sections after the prompt explain WHY an instruction is phrased as it is.
    Sent to the model they would read as contradictory guidance."""
    prompt = load_prompt(file)
    assert "## Why" not in prompt
    assert "## Note" not in prompt
    assert "```" not in prompt


def test_card_prompt_exposes_the_placeholders_the_agent_fills() -> None:
    prompt = load_prompt("card-generation.md")
    for var in ("{{topic_name}}", "{{topic_description}}", "{{scraped}}", "{{generated}}"):
        assert var in prompt


def test_fact_check_prompt_exposes_its_placeholders() -> None:
    prompt = load_prompt("fact-check.md")
    for var in ("{{card_content}}", "{{scraped}}", "{{generated}}"):
        assert var in prompt


# The output contract must live INSIDE the prompt block. The `## Output` section
# documents it for humans and is never sent, so a key named only there is a key
# the model has to invent - which it did: the fact-check prompt described
# failed_claim and reason but never named `verdict`, and the model returned
# {"result": "pass"} instead, erroring every card on the first live run.
OUTPUT_KEYS = {
    "data-generation.md": ["content", "confidence"],
    "card-generation.md": [
        "content",
        "source_url",
        "trust_label",
        "why_it_matters",
        "recall_prompt",
        "recall_answer",
    ],
    "fact-check.md": ["verdict", "reason", "failed_claim"],
}


@pytest.mark.parametrize(("file", "keys"), list(OUTPUT_KEYS.items()))
def test_prompt_names_its_own_output_keys(file: str, keys: list[str]) -> None:
    prompt = load_prompt(file)
    for key in keys:
        assert key in prompt, f"{file} never names the output key {key!r} in the prompt itself"


def test_render_substitutes_every_occurrence() -> None:
    assert render("{{a}} and {{a}} and {{b}}", a="x", b="y") == "x and x and y"


def test_render_keeps_an_if_block_when_the_value_is_present() -> None:
    assert render("{{#if x}}kept{{/if}}", x="yes") == "kept"


def test_render_drops_an_if_block_when_the_value_is_empty() -> None:
    assert render("{{#if x}}dropped{{/if}}", x="") == ""


def test_missing_file_raises() -> None:
    with pytest.raises(FileNotFoundError):
        load_prompt("no-such-prompt.md")
