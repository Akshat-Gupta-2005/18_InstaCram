# Fact-Check Agent

Runs in the **pipeline** service. The sole quality gate — nothing reaches a user without passing here.

A failure is permanent: the draft is quarantined and never retried (v1). So the cost of a false reject is a card that is silently never written, and if every draft for a topic fails, the topic ends up `status='empty'` and is never served. **Calibration matters more here than anywhere else in the pipeline.**

## Input

- `card` — one draft from the card generator
- `scraped` — the same source material the card was written from
- `generated` — the supplementary material

## Output

```json
{ "verdict": "pass" | "fail", "reason": "…", "failed_claim": "…" | null }
```

## Prompt

```
You are checking one short learning card for factual correctness before it is shown
to a user who has no way to verify it themselves.

CARD:
{{card_content}}

SOURCE MATERIAL THE CARD WAS WRITTEN FROM:
{{scraped}}

SUPPLEMENTARY MATERIAL:
{{generated}}

Check each factual claim in the card against the material above and against your own
knowledge. Return "fail" if ANY of these is true:

- A claim contradicts the source material.
- A claim is stated as fact but appears nowhere in the material and is not something
  you independently know to be correct.
- A specific figure, complexity bound, version, or threshold is wrong.
- The recall_answer does not actually answer the recall_prompt, or is not supported
  by the card's own content.
- The card reproduces a distinctive sentence from the source material rather than
  restating it.

Do NOT fail a card for:
- being incomplete — these are short cards, omission is expected and is not an error
- simplifying, as long as the simplification is not misleading
- style, tone, or your preference for different phrasing
- covering a narrow aspect of the topic rather than the whole topic

Whatever you decide, say why in "reason" — for a pass, one line on what you
checked; for a fail, what is wrong. If you fail it, also name the specific claim
in "failed_claim". Both are read by a human diagnosing whether this checker is too
strict — "seems inaccurate" is useless to them. Be specific enough that someone
can tell from your reason alone whether you were right.

Return JSON only, exactly these keys:
{"verdict": "pass" | "fail", "reason": "...", "failed_claim": "..." | null}
```

## Why the output shape is repeated inside the prompt

The `## Output` block above documents the contract for a human reader; it is **not** sent to the model, because the loader takes only the fenced block under `## Prompt`. The first live run of this agent proved why that matters: the prompt named `failed_claim` and `reason` in passing but never named `verdict`, so the model returned `{"result": "pass"}` and every card errored. Any field name that exists only in `## Output` is a field name the model has to guess. A test asserts each agent prompt names its own output keys.

## Why the "do not fail for" list is as long as the fail list

The asymmetry that makes this necessary: an over-strict checker and a weak card generator produce **the same rejection rate**, and with no retry, over-strictness silently thins the corpus with nothing reporting it. A checker left to its own judgement drifts toward rejecting anything it would have written differently — incompleteness and simplification are the two it reaches for first, and both are properties this format requires rather than defects.

The `reason` and `failed_claim` fields exist for the quarantine table (BUILD-PLAN §4.3). They are what makes the eventual "is the checker too strict, or is the generator bad?" question answerable, and that question is what the deferred no-retry decision is waiting on (P10). A vague reason makes the whole quarantine worthless.
