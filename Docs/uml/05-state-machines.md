# 05 — State machines

Five things in this system have states, and each state exists because collapsing it into another one caused a bug.

---

## 5.1 Topic — the most important three words in the schema

```mermaid
stateDiagram-v2
    [*] --> pending : no match — topic + outbox, one txn

    pending --> ready : a draft passed fact-check
    pending --> empty : no draft survived, or no source

    empty --> pending : re-queued (same row)
    ready --> ready : more cards from a later run

    note right of empty
        Why this state must exist:
        without it, a topic whose drafts
        all failed is cached as a SUCCESS
        and re-served forever.
        The lookup treats empty as a MISS.
    end note

    note right of pending
        Two things leave a topic PENDING rather
        than moving it. A worker CLAIMS it:
        claimed_at is a lease and doubles as
        backoff, so a stale claim is reclaimable
        and a worker that dies loses nothing.
        Or the run ends DEGRADED, meaning the
        checker broke rather than the card.
    end note
```

**Three ways a topic ends with no cards, deliberately kept apart:**

| Outcome | What failed | Topic left as | Drafts quarantined? |
|---|---|---|---|
| `unsourced` | no source could ground it | `empty` | no drafts existed |
| `empty` | every draft was rejected | `empty` | yes, with reasons |
| `degraded` | **the checker itself** errored | `pending` | **no** |

Collapsing these into "no cards" would report a 100% rejection rate for a broken gate and send someone to fix the generator — which is exactly what P10 and P29 were about.

---

## 5.2 Field expansion — candidate generation as a job

```mermaid
stateDiagram-v2
    [*] --> pending : enqueued by a feed request (kind='initial')<br/>or a "more topics" tap (kind='more')

    pending --> running : claimed (SKIP LOCKED), claimed_at set
    running --> done : candidates resolved,<br/>counts recorded
    running --> pending : attempt failed → backoff,<br/>next_attempt_at in the future
    running --> pending : worker died → REAPED<br/>(stale claim)
    pending --> failed : attempts exhausted

    done --> [*]
    failed --> [*]

    note right of pending
        An INITIAL expansion is enqueued at
        most ONCE per field, ever, and never
        for a field that already has topics.
        Otherwise a client polling every 3s
        buys a 32–54s LLM run each time (P16).
    end note

    note right of done
        kind='more' + done + topics_queued=0
        + topics_linked=0 + failed_retried=0
        = the field is genuinely exhausted.
        The client stops offering the action.
    end note
```

A partial failure while resolving finishes the job rather than regenerating: 32–54s of LLM output has already been paid for, and throwing it away to retry one candidate is the expensive kind of tidy.

---

## 5.3 Outbox row — owed vectors

```mermaid
stateDiagram-v2
    [*] --> pending : written in the SAME transaction<br/>as the topic

    pending --> processing : claimed by the outbox worker
    processing --> done : vector upserted into Qdrant
    processing --> pending : write failed → attempts += 1,<br/>last_error kept, next_attempt_at backed off
    processing --> pending : worker died mid-row → REAPED
    pending --> failed : retries exhausted → DEAD LETTER

    failed --> pending : reconciliation notices the missing<br/>vector and re-enqueues it

    note right of failed
        Non-zero dead letters mean the slow
        sweep is now carrying work the fast
        path gave up on. Worth an alert,
        not a panic.
    end note
```

Reconciliation is **asymmetric on purpose**: a vector missing from Qdrant is re-enqueued (wasteful, safe), an orphan vector in Qdrant is deleted (a stale hit would be corruption).

---

## 5.4 Scroll — retire, never delete

```mermaid
stateDiagram-v2
    [*] --> live : persisted after passing fact-check
    live --> retired : flagged incorrect (retired_at set)

    state live {
        [*] --> servable
        servable : appears in feed, revision, saves
        servable : reachable through live_scroll
    }

    state retired {
        [*] --> invisible
        invisible : gone from EVERY read path
        invisible : view history preserved
        invisible : row still exists
    }

    note right of retired
        A DELETE is blocked by trigger once
        anyone has viewed the card: deleting
        it would cascade away the view log,
        which is both the paging position and
        unrebuildable (P20).
    end note
```

---

## 5.5 The feed page, as the client sees it

```mermaid
stateDiagram-v2
    [*] --> loading : first request in flight

    loading --> reading : cards arrived
    loading --> waiting : zero cards, generating:true
    loading --> finished : zero cards, exhausted:true

    reading --> reading : J / swipe → next card;<br/>view logged after 600ms
    reading --> waiting : ran out of cards in hand,<br/>field still generating
    reading --> finished : ran out, nothing on the way

    waiting --> reading : a poll returned new cards<br/>(they take the CURRENT index —<br/>no scroll position to snap back to)
    waiting --> finished : expansion done, nothing produced

    finished --> waiting : "More topics" tapped
    finished --> revision : "Revise this field"
    finished --> [*] : "Go to a related field"

    revision --> revision : seen cards, oldest first,<br/>never exhausted

    note right of finished
        The feed NEVER silently loops back to
        the start. Continuing is always one of
        three explicit actions — that is the
        engagement pattern streaks were
        excluded to avoid (P8).
    end note
```

**What to notice.** `waiting` and `finished` look identical to a careless client — both are "no cards" — and conflating them shows the end-of-field card to someone whose field is 30 seconds old. That is why `generating` and `exhausted` are separate flags rather than one enum, and why an *owed* expansion counts toward `generating`.
