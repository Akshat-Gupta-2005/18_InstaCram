# Card Generation LLM

Runs in the **pipeline** service after the scraper and data-gen agent have both finished. Produces the draft scrolls for one topic.

## Input

- `topic_name`, `topic_description`
- `scraped` — array of `{ text, source_url }`
- `generated` — `{ content, confidence }` from the data-gen agent

## Output

```json
{
  "cards": [
    {
      "content": "…",
      "source_url": "https://…",
      "trust_label": "sourced_verified" | "ai_generated",
      "why_it_matters": "…",
      "recall_prompt": "…",
      "recall_answer": "…"
    }
  ]
}
```

## Prompt

```
Write short learning cards about one concept. Each card is read in about the time
it takes to watch one short-form video — roughly 20 seconds.

TOPIC: {{topic_name}}
THIS MEANS: {{topic_description}}

SOURCE MATERIAL (scraped, with URLs):
{{scraped}}

SUPPLEMENTARY MATERIAL (model-generated, confidence: {{confidence}}):
{{generated}}

Write 2 to 4 cards. Each card covers ONE distinct aspect of the topic — do not
write four cards restating the same definition.

=== THE RULE THAT MATTERS MOST ===
The scraped material is your GROUNDING, not your content. Write original prose.
Do not reproduce sentences or distinctive phrasings from the source material, even
when they are well written and even when it would be shorter to do so. If a card
would only be correct by copying a source's exact wording, write a different card.

=== PER-CARD REQUIREMENTS ===

content:
  - One page. No headings, no bullet lists longer than three items, no "in this
    card we will". Start with the thing itself.
  - Self-contained. A reader who has seen no other card must follow it.
  - Concrete. Prefer the specific cost, constraint, or behaviour over a general
    characterisation.

source_url:
  - The URL from the scraped material that most directly supports this card.
  - If a card rests on supplementary material rather than a source, still give the
    closest supporting URL and set trust_label to "ai_generated".

trust_label:
  - "sourced_verified" when the card's claims are supported by the scraped material.
  - "ai_generated" when the card rests mainly on supplementary material.
  - When in doubt, use "ai_generated". Over-claiming verification is worse than
    under-claiming it: a user who cannot check a fact is relying on this label.

why_it_matters:
  - One sentence. The situation where knowing this changes what you do.
  - Not "it is widely used" or "it is fundamental". A real moment: an interview
    question, a decision between two options, a bug this explains.

recall_prompt / recall_answer:
  - A question answerable from THIS card, and its answer.
  - The question must require retrieving something, not recognising it. Avoid
    yes/no and avoid questions whose wording gives the answer away.
  - The answer is one or two sentences.

Return JSON only.
```

## Why the copying rule is stated that forcefully

The architecture removes the *intent* to republish — scraped text never reaches the output path — but it cannot by itself guarantee the *outcome*. A model handed a short snippet and asked for a short card will reproduce it closely unless told not to, and the failure is invisible: the output looks like ordinary generated prose (P1). The instruction to write a different card rather than copy is the part that matters; without an escape hatch the model will take the copying route when the source is the only concise phrasing available.
