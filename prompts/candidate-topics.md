# Candidate Topic Generator

Runs in the **serving** service on every field request, including pure cache hits. The highest-frequency LLM call in the system — keep the output tight.

> **The `description` format is load-bearing and is not free prose.** On a cache miss this exact string is stored as `topic.description` and embedded; on every future request it is the query text compared against stored vectors. Both sides of every similarity comparison come from this prompt. Changing its shape or length invalidates every stored vector *and* the calibrated threshold (invariant 9, P9). Treat edits to it as a schema migration.

## Input

- `field` — the field name as the user typed it
- `exclude` — topic names already linked to this field (empty on a first request; populated on expansion)

## Output

Strict JSON, no prose around it:

```json
{ "topics": [ { "name": "HashMap", "description": "Hash-table map storing key-value pairs with average constant-time lookup." } ] }
```

## Prompt

```
You generate the list of atomic topics that make up a field of study or practice.

FIELD: {{field}}

{{#if exclude}}
These topics already exist for this field. Do not propose them or close paraphrases
of them. Go further into the field rather than repeating its most obvious entries:
{{exclude}}
{{/if}}

Produce up to 20 topics. Each must be:
- ATOMIC — one concept that stands alone, not a category containing others.
  "HashMap" yes. "Java Collections" no, that is the field itself.
- EXPLAINABLE ON ONE PAGE — no multi-step reasoning, no topic that needs
  prerequisites explained first.
- REAL — a term a practitioner in this field would recognise, not one you invented
  to fill the list.

For each topic write a description that is EXACTLY:
- one sentence
- 15 words or fewer
- a definition of what the concept IS
- specific enough to distinguish this concept from another with the same name in a
  different field. A "Stack" in data structures and a "Stack" in web development
  must produce descriptions that could never be confused for each other.

Do NOT include: examples, use cases, why it matters, history, or any sentence that
begins "This is used for". Those belong on the card, not here.

Return JSON only: {"topics": [{"name": "...", "description": "..."}]}
```

## Why the description rules are shaped this way

The disambiguation constraint is the whole point. The v1 matching strategy is strict-threshold name+description similarity with no second-stage check (P4), so the *only* thing keeping "Stack" the data structure apart from "Stack" the technology stack is whether their descriptions embed differently. A vague description ("a way of organising things") collapses that distance; a specific one preserves it.

The prohibition on use cases is not style. Use-case text is generic across unrelated concepts — "used to build scalable applications" describes half of computing — and it drags every vector toward the same region, compressing exactly the distances the threshold needs.

Model: whatever the LiteLLM gateway resolves as default. Temperature low — this is enumeration, not creativity.
