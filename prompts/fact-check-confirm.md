# Fact-Check Agent — confirming a contradiction (v2)

Runs in the **pipeline** service, only when a chunk pass has returned `contradicted` **and** `FACT_CHECK_CONFIRM` is on — it is off in production. See `app/agents/fact_check.py`.

## Input

- `card_content` — the whole draft, for context
- `claim` — the claim the chunk pass said was contradicted (or the whole card, if it named none)
- `excerpt` — the one excerpt that was said to contradict it

## Output

```json
{
  "claim_sentence": "…",
  "excerpt_sentence": "…",
  "same_subject": true | false,
  "cannot_both_be_true": true | false,
  "reason": "…"
}
```

The contradiction is confirmed only when **both** booleans are true. That decision is made in code, not by the model.

## Prompt

```
Another reviewer read the excerpt below and concluded that it CONTRADICTS a claim
in a short learning card. Check that conclusion by comparing two SENTENCES, not
two topics.

CARD, FOR CONTEXT:
{{card_content}}

CLAIM UNDER DISPUTE:
{{claim}}

EXCERPT SAID TO CONTRADICT IT:
{{excerpt}}

Work in this order.

1. "claim_sentence": copy the ONE sentence of the claim that the excerpt bears on
   most directly. If the claim has several sentences, choose the specific one - not
   a general definition that happens to open it.

2. "excerpt_sentence": copy the ONE statement from the excerpt that bears most
   directly on that sentence. Quote it; do not paraphrase.

3. "same_subject": are those two sentences about the same thing? Answer false when
   they describe different things that share a name or a topic - for example a
   sentence about the range of electric cars and a statement about the range of
   petrol cars, or a sentence about how much sleep adults need and a statement
   about infants.

4. "cannot_both_be_true": could both sentences be true at the same time? Answer
   true only if they cannot. Judge the two SENTENCES, not the topic. An excerpt can
   support a topic in general and still contradict one sentence about it: an
   excerpt saying water boils at 100 C at sea level is entirely about boiling water,
   and still cannot be true alongside a sentence saying water boils at 50 C at sea
   level. Directions and numbers matter - "more" versus "less", "twice" versus
   "half", "first" versus "last".
   Answer false when the excerpt only adds a detail the sentence does not mention -
   a sentence saying a bridge is in Sydney and a statement that it is 134 m high can
   both be true. Answer false when you found no excerpt statement that actually
   bears on the sentence.

5. "reason": one or two sentences explaining both answers.

Return JSON only, exactly these keys:
{"claim_sentence": "...", "excerpt_sentence": "...", "same_subject": true | false, "cannot_both_be_true": true | false, "reason": "..."}
```

## Why v2 compares sentences, and why it is shaped this way

The first version asked one yes/no question: does this excerpt say the claim is false, about the same subject? Measured, it kept **5/5** true cards but caught only **5/8** planted lies. Its own reasons showed why: it judged the *topic*. For a card claiming people weigh gains more than losses, against an excerpt showing the reverse, it answered *"this supports the claim about loss aversion"*. The disputed claim also carried the card's correct opening definition, which masked the false sentence. v2 makes the model name the specific claim sentence and the specific excerpt statement before judging anything, then splits the judgement into the two questions that were being blurred — *same subject?* and *can both be true?* — and combines them in code.

## Why every example is from an unrelated domain

v1's examples of what is *not* a contradiction were the linked-list and priority-queue cards the confirmation was then measured on, so its 5/5 partly measured recall of its own instructions. v2's examples — cars, sleep, boiling water, a bridge — share nothing with the development or held-out cases, and a test fails if a topic from either set appears in this prompt.

## Why the claim comes before the excerpt

The runtime truncates an over-long prompt from the front (P33). Excerpts are sized to fit, but if that ever fails, what is lost must not be the thing being judged.
