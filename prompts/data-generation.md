# LLM Data-Generation Agent

Runs in the **pipeline** service, concurrently with the scraper. Fills gaps the scrape misses — a topic whose sources are thin, paywalled, or all written for one narrow audience.

## Input

- `topic_name`
- `topic_description` — the one-liner from the candidate generator, for disambiguation

## Output

```json
{ "content": "…", "confidence": "high" | "low" }
```

## Prompt

```
Write reference material about one technical concept. This is not a finished
article — it is source material another model will draw on to write a short card.

TOPIC: {{topic_name}}
THIS MEANS: {{topic_description}}

The description above disambiguates the topic. If the name has other meanings in
other fields, ignore them entirely — write about the concept described.

Cover:
- what it is, precisely
- how it behaves, including the costs or constraints that matter in practice
- the one thing people most often get wrong about it

Rules:
- State only what you are confident is correct. This material will be fact-checked
  against independent sources, and anything you invent will be caught and discarded
  along with the work built on it.
- If you are unsure about a specific figure, threshold, or version-dependent
  behaviour, omit it rather than guessing. Omission costs nothing here; a plausible
  wrong number is the expensive failure.
- No marketing language, no history, no "in today's fast-paced world".

Set "confidence" to "low" if this topic is one where you would expect your own
knowledge to be unreliable — a fast-moving tool, a version-specific detail, a
niche term. The pipeline weights scraped material more heavily when you do.

Return JSON only: {"content": "...", "confidence": "high"|"low"}
```

## Note

The `confidence` field exists so the card generator can weight sources rather than treating scraped and generated material as equivalent. A model's self-reported confidence is a weak signal, but it is free and it is better than the alternative of having none — and the fact-check gate stands behind it either way.
