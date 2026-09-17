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
    "fact-check-chunk.md",
    "fact-check-confirm.md",
    "candidate-topics.md",
    "adjacent-fields.md",
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


def test_chunk_prompt_exposes_its_placeholders() -> None:
    prompt = load_prompt("fact-check-chunk.md")
    for var in ("{{card_content}}", "{{excerpt}}", "{{part}}", "{{total}}"):
        assert var in prompt


def test_confirm_prompt_exposes_its_placeholders() -> None:
    prompt = load_prompt("fact-check-confirm.md")
    for var in ("{{card_content}}", "{{claim}}", "{{excerpt}}"):
        assert var in prompt


def test_confirm_prompt_compares_sentences_not_topics() -> None:
    """v1 judged the topic ("this supports the claim about loss aversion") and let
    3 of 8 planted lies through. These are the instructions that address that."""
    prompt = " ".join(load_prompt("fact-check-confirm.md").lower().split())
    assert "sentences, not two topics" in prompt
    assert "support a topic in general and still contradict" in prompt


def test_confirm_prompt_never_mentions_a_topic_it_is_measured_on() -> None:
    """Teaching to the test, made structural. v1's examples WERE the development
    cases, so its 5/5 on them measured recall of its own instructions. Any topic
    from the negative control's development or held-out set appearing in this
    prompt fails here."""
    prompt = load_prompt("fact-check-confirm.md").lower()
    measured_topics = [
        "hashmap", "hash map", "loss aversion", "linked", "priority queue", "heap",
        "anchoring", "endowment", "queue", "lisp", "capuchin", "mug",
    ]
    leaked = [t for t in measured_topics if t in prompt]
    assert leaked == [], f"confirmation prompt mentions measured topics: {leaked}"


def test_confirm_prompt_puts_the_claim_before_the_excerpt() -> None:
    # The runtime drops the FRONT of an over-long prompt (P33).
    prompt = load_prompt("fact-check-confirm.md")
    assert prompt.index("{{claim}}") < prompt.index("{{excerpt}}")


def test_chunk_prompt_says_absence_is_not_contradiction() -> None:
    """The one instruction the chunk pass cannot work without.

    Without it the model treats "this fragment does not mention the claim" as
    grounds to fail, and since almost every claim is missing from almost every
    fragment, nearly every card would be falsely rejected - with no retry to
    recover it. Asserted on the real file because deleting this paragraph would
    break the gate in a way no other test would notice.
    """
    # Whitespace-normalised: the instruction is wrapped across lines in the file,
    # and where the wrap happens is not what this test is about.
    prompt = " ".join(load_prompt("fact-check-chunk.md").lower().split())
    assert "not a contradiction" in prompt
    assert "fragment" in prompt


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
    "fact-check-chunk.md": [
        "verdict",
        "reason",
        "failed_claim",
        "contradicted",
        "supported",
        "not_covered",
    ],
    "adjacent-fields.md": ["fields"],
    "fact-check-confirm.md": [
        "claim_sentence",
        "excerpt_sentence",
        "same_subject",
        "cannot_both_be_true",
        "reason",
    ],
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
