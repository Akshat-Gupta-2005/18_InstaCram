# Adjacent-Field Suggester

Runs in the **serving** service, in the background after a field's expansion (task 5.7). Its output is stored and shown on the end-of-field card when the field shares few topics with other fields.

## Input

- `field` — the field the user has just finished

## Output

```json
{ "fields": ["…", "…"] }
```

## Prompt

```
A learner has just finished studying short cards on the field below. Suggest
related fields they could study next.

FIELD: {{field}}

Rules:
- Suggest up to 5 fields, most relevant first.
- Each must be closely related to the field above - a natural next step, a
  neighbouring subject, or a more specific area within it. Not a broad discipline
  the field merely belongs to.
- Each must be a different field from the one above, not a rewording of it.
- Use short names a learner would type into a search box: 1 to 5 words, no
  explanations, no numbering.

Return JSON only, exactly this key:
{"fields": ["...", "..."]}
```

## Why "not a broad discipline"

Measured before this prompt existed, a plain request for fields related to *Java Data Structures* returned "Web Development" and "Software Engineering" alongside "Algorithms". A learner who finished a field of specific cards gains little from being pointed at a whole discipline, and a broad field is also the most expensive thing to generate next.

## Why the output is only names

The suggestion becomes a field name the user can tap, and tapping it starts an ordinary cold start that generates topics and their descriptions itself. Descriptions produced here would be discarded, and would cost tokens on a call that already takes ~8s idle and ~57s while the pipeline is busy.
