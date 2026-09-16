# Fact-Check Agent — confirming a contradiction

Runs in the **pipeline** service, only when a chunk pass has returned `contradicted`. A card is rejected on the chunked path only if this call agrees. See `app/agents/fact_check.py`.

## Input

- `card_content` — the whole draft, for context
- `claim` — the specific claim the chunk pass said was contradicted (or the whole card, if it named none)
- `excerpt` — the one excerpt that was said to contradict it

## Output

```json
{ "confirmed": true | false, "reason": "…" }
```

## Prompt

```
Another reviewer read the excerpt below and concluded that it CONTRADICTS a claim
in a short learning card. Your job is to check that conclusion, narrowly. You are
not re-reviewing the card.

CARD, FOR CONTEXT:
{{card_content}}

CLAIM UNDER DISPUTE:
{{claim}}

EXCERPT SAID TO CONTRADICT IT:
{{excerpt}}

Answer one question: does this excerpt state that the claim is FALSE, about the
SAME subject the claim is about?

Answer "confirmed": true ONLY if the excerpt asserts something that cannot be true
at the same time as the claim, and both are about the same thing.

Answer "confirmed": false if ANY of these is the case - each one has been mistaken
for a contradiction before:
- The excerpt describes a DIFFERENT implementation, variant, version, or context
  than the one the claim is about. A claim about heaps is not contradicted by an
  excerpt describing a priority queue built from a sorted list.
- The excerpt ADDS information the claim does not mention. A claim that a node has
  two pointers is not contradicted by an excerpt noting that this costs memory.
- The excerpt is silent on the claim, or only related to it.
- The conflict exists only by inference ("this implies...") rather than by what the
  excerpt actually states.

When unsure, answer false. Say why in "reason", naming what the excerpt states and
whether it is about the same subject as the claim.

Return JSON only, exactly these keys:
{"confirmed": true | false, "reason": "..."}
```

## Why this call exists

The chunk pass's own prompt already forbids treating extra detail or a different variant as a contradiction, and the model did it anyway: of the first four live rejections on the chunked path, **three were false** — a true card about doubly-linked-list pointers rejected because the excerpt also mentioned memory cost, and two true cards about heap-based priority queues rejected because an excerpt described a different implementation. An instruction already present and already ignored is not fixed by repeating it louder. A second, narrower question is a different instrument: it sees one claim and one excerpt, and the only thing it is asked is the thing the first call got wrong.

## Why "when unsure, answer false"

No retry exists in v1, so a false rejection is a card lost permanently, while a false acceptance on this path still has to survive every other excerpt and, if nothing supports it, the single-pass fallback. The expensive error is the rejection, so doubt resolves toward keeping the card.

## Why the claim comes before the excerpt

The runtime truncates an over-long prompt from the front (P33). Excerpts are sized to fit, but if that ever fails, what is lost must not be the thing being judged.
