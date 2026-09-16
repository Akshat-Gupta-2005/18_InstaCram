# Fact-Check Agent — chunk pass

Runs in the **pipeline** service, once per slice of a long source, when the material is too large to fit one context window. Its verdicts are combined by `app/agents/fact_check.py`; no chunk decides a card's fate alone.

## Input

- `card_content` — the draft being checked, whole, in every chunk
- `excerpt` — one slice of the source material
- `part` / `total` — which slice this is

## Output

```json
{ "verdict": "contradicted" | "supported" | "not_covered", "reason": "…", "failed_claim": "…" | null }
```

## Prompt

```
You are checking one short learning card against ONE EXCERPT of a longer source
document. This is excerpt {{part}} of {{total}}. You are seeing a fraction of the
material, and the rest of it is not available to you.

CARD:
{{card_content}}

EXCERPT {{part}} OF {{total}}:
{{excerpt}}

First, list to yourself each SPECIFIC claim the card makes - each direction ("X is
larger than Y"), each number, each name, each date, each bound. Then compare each
one against this excerpt. Then return exactly one of:

"contradicted" - this excerpt states something incompatible with one of those
  claims. Name the card's claim in "failed_claim". In particular this includes:
    - the excerpt states the relationship in the OPPOSITE direction from the card
      (the card says A outweighs B; the excerpt says B outweighs A)
    - the excerpt gives a different value for the same quantity than the card does
    - the excerpt credits a different person, work, or date than the card does
    - the card's claim is internally impossible given what the excerpt establishes

"supported" - this excerpt confirms the card's SPECIFIC claims. The excerpt being
  about the same subject as the card is NOT support. Before answering "supported",
  check that the excerpt agrees with what the card actually asserts - the
  direction, the figure, the attribution - and not merely that both are discussing
  the topic. A card that states the reverse of this excerpt is "contradicted", not
  "supported", however much vocabulary they share.

"not_covered" - this excerpt is about something else, or covers the topic without
  bearing on the card's particular claims.

THE MOST IMPORTANT RULE: a claim being ABSENT from this excerpt is NOT a
contradiction. You are reading a fragment. Almost everything true about this topic
is missing from any given fragment, and the parts you cannot see are where most of
the card's support lives. If the excerpt does not address a claim, that is
"not_covered". Only answer "contradicted" when this excerpt positively asserts
something incompatible - not when it is silent, vague, or merely does not mention
it.

Do NOT answer "contradicted" for:
- a claim this excerpt does not discuss
- the card being shorter, simpler, or less complete than the excerpt
- the card covering a narrow aspect rather than the whole topic
- style, tone, or phrasing you would have chosen differently
- a number the card rounds or approximates, where the excerpt's value is close

Absence is "not_covered". Disagreement is "contradicted". Agreement on the card's
actual assertions is "supported". Sharing a subject is none of the three on its own.

Say why in "reason", specifically enough that someone reading only your reason can
tell whether you were right. Set "failed_claim" to the card's offending claim when
the verdict is "contradicted", and to null otherwise.

Return JSON only, exactly these keys:
{"verdict": "contradicted" | "supported" | "not_covered", "reason": "...", "failed_claim": "..." | null}
```

## Why absence is not contradiction

This is the whole reason chunked checking needs a different prompt rather than the single-pass one run in a loop. The single-pass prompt fails a card when a claim "appears nowhere in the material and is not something you independently know to be correct" — correct when the model holds the entire source, and catastrophic per-chunk. Every claim appears nowhere in most chunks. Running the single-pass prompt over N chunks and failing on any "fail" would reject very nearly every card, and with no retry (v1) each false reject is a card silently never written. The expensive direction here is over-strictness, so the chunk pass is built to under-report: it can only raise a contradiction it can actually see.

## Why the card is repeated in every chunk

The card is the thing being judged, so it cannot be the thing that gets split. It is also placed **before** the excerpt: Ollama truncates an over-long prompt from the front, and anything earlier than the card in the prompt is what should be lost first if the budget is miscalculated. The excerpt is sized so this never happens, but the ordering means a miscalculation degrades into a worse-grounded check rather than a check with no card in it — which is exactly the failure this prompt exists to fix (P33).

## Why the output shape is repeated inside the prompt

The `## Output` block above documents the contract for a human reader; it is **not** sent to the model, because the loader takes only the fenced block under `## Prompt`. A field name that exists only in `## Output` is a field name the model has to guess, and on the first live run of the single-pass checker it guessed `result` instead of `verdict` and errored every card. A test asserts each agent prompt names its own output keys.
