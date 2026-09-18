# 04 — Sequences

Six things that happen, in order. These are the diagrams to read when you want to know *what actually runs* on a tap.

---

## 4.1 Cold start — a field nobody has asked for

The expensive path. Note where the request returns: long before any card exists.

```mermaid
sequenceDiagram
    autonumber
    actor U as Learner
    participant A as Expo app
    participant S as serving
    participant PG as postgres
    participant EW as expansion worker<br/>(inside serving)
    participant GW as llm-gateway → Ollama
    participant EMB as embeddings
    participant QD as qdrant
    participant TW as topic worker<br/>(pipeline)

    U->>A: names "Marine Biology"
    A->>S: POST /v1/feed
    S->>PG: find or create field
    S->>PG: enqueue expansion (kind='initial')
    Note over S,PG: at most ONCE per field, ever —<br/>polling must not buy another<br/>32–54s LLM run (P16)
    S->>PG: unviewed cards? → none
    S-->>A: 200 generating:true, retry_after_ms<br/><b>~224ms</b>
    A->>A: show waiting state, poll at the server's cadence

    Note over EW: meanwhile, in the background
    EW->>PG: claim the expansion (SKIP LOCKED)
    EW->>GW: field → candidate topics + descriptions
    GW-->>EW: 20 candidates (32–54s)

    loop each candidate
        EW->>PG: pg_advisory_xact_lock(hash of name)
        EW->>EMB: embed(name + description)
        EW->>QD: search topic_names @ 0.955
        EW->>PG: same-name rows whose vector is still owed
        alt match found
            EW->>PG: INSERT field_topic  ← reuse, zero LLM cost
        else no match
            EW->>PG: INSERT topic(pending) + outbox row<br/>(one transaction)
        end
    end

    Note over TW: independently, no call from serving
    TW->>PG: claim a pending topic (SKIP LOCKED)
    TW->>TW: scrape ∥ data-gen → card-gen → fact-check
    TW->>PG: cards + quarantine + counters (one transaction)<br/>topic → ready

    A->>S: POST /v1/feed (next poll)
    S->>PG: unviewed cards
    S-->>A: cards as each topic finishes
    Note over U,A: 1.5–10 min per topic, sequential.<br/>A whole field is 40–100 min.
```

**What to notice.** The user-facing request does four cheap database operations and returns. Everything expensive happens after it, in two workers that do not know about each other. Cards appear **per topic**, not per field, so a cold field becomes usable long before it is finished.

---

## 4.2 Cache hit — the whole thesis in one diagram

```mermaid
sequenceDiagram
    autonumber
    actor U as Learner
    participant S as serving
    participant EW as expansion worker
    participant EMB as embeddings
    participant QD as qdrant
    participant PG as postgres

    U->>S: names "Java Collections"<br/>(HashMap already exists from another field)
    S->>PG: enqueue expansion
    S-->>U: generating:true

    EW->>EMB: embed("HashMap" + description)
    EW->>QD: search topic_names
    QD-->>EW: HashMap @ 0.981 ≥ 0.955
    EW->>PG: INSERT field_topic (field, existing topic)

    Note over EW,PG: no scrape. no card generation.<br/>no fact-check. one row.

    U->>S: POST /v1/feed (next poll)
    S->>PG: unviewed cards for this field
    PG-->>S: the EXISTING cards, unchanged
    S-->>U: identical scroll IDs, served under a new field
```

**What to notice.** This is the acceptance test of the entire design (`tests/reuse.test.ts`), and it was **seen failing with reuse disabled**. The threshold `0.955` is deliberately strict: it was chosen as the lowest cutoff with *zero* false merges over 44 labelled pairs, keeping 67% reuse. The system would rather regenerate a duplicate than show you a card about the wrong thing.

---

## 4.3 Reading, paging and view logging — where the data is easiest to corrupt

```mermaid
sequenceDiagram
    autonumber
    actor U as Learner
    participant R as Reader / SwipeFeed
    participant H as useFeed
    participant S as serving
    participant PG as postgres

    U->>R: opens a field
    R->>H: mount
    H->>S: POST /v1/feed (limit 10)
    S->>PG: cards this account has NOT viewed
    S-->>H: 10 cards + progress {viewed, total}
    H->>H: seenBefore = progress.viewed − counted this visit
    R->>U: "Card 64 of 91"

    U->>R: reads card 64
    R->>R: 600ms on screen →
    R->>H: onDisplayed(index, card)
    H->>H: buffer the view
    Note over H: only if the screen is FOCUSED —<br/>hidden stacked screens logged<br/>cards nobody saw (P38)
    H->>S: POST /v1/views  (~1s later, batched)
    S->>PG: INSERT user_view (append-only)

    U->>R: presses J three times
    R->>H: onDisplayed × 3
    H->>S: POST /v1/views (one batch)

    alt fewer than 3 cards left in hand
        H->>S: POST /v1/feed
        Note over H,S: views are flushed FIRST, so the server<br/>does not hand back cards already shown
        S-->>H: the next 10 unviewed
    end

    U->>U: refreshes the browser
    Note over H: pagehide → flush with keepalive,<br/>so the request outlives the page (P38)
    H->>S: POST /v1/views (keepalive)
```

**What to notice.** There is **no cursor**. "The next page" means "cards this account has not viewed", so the view log *is* the pagination state. A lost view hands the same card out again; an invented view silently burns a card the user never saw. Both happened, and neither raised an error — see P38.

---

## 4.4 "More topics" — the only user-triggered generation

```mermaid
sequenceDiagram
    autonumber
    actor U as Learner
    participant A as app
    participant S as serving
    participant PG as postgres
    participant EW as expansion worker

    U->>A: taps "More topics" on the end card
    A->>S: POST /v1/fields/{id}/expand
    S->>PG: re-queue this field's failed topics (empty → pending)
    S->>PG: enqueue expansion kind='more'<br/>unless one is already open
    S-->>A: 202 {expansion, failed_retried, retry_after_ms}
    Note over S,A: returns BEFORE candidates exist —<br/>what it achieved arrives later,<br/>on the feed as last_expansion

    EW->>PG: claim
    EW->>EW: candidates, EXCLUDING the field's existing topics
    EW->>PG: resolve each → queued / linked / reused
    EW->>PG: complete the expansion with its counts

    A->>S: POST /v1/feed (poll)
    S-->>A: last_expansion {kind:'more', status:'done',<br/>topics_queued, topics_linked, failed_retried}
    alt all three are zero
        A->>U: field is genuinely exhausted — stop offering the action
    else anything non-zero
        A->>U: keep going
    end
```

**What to notice.** Generation is never triggered by paging or polling — only by an explicit tap (P16, P17). `topics_linked` exists because a field can gain cards *without generating anything*, and without counting that, the action would be offered forever.

---

## 4.5 The outbox — why a vector write cannot lose a topic

```mermaid
sequenceDiagram
    autonumber
    participant EW as expansion worker
    participant PG as postgres
    participant OW as outbox worker
    participant EMB as embeddings
    participant QD as qdrant

    EW->>PG: BEGIN
    EW->>PG: INSERT topic (pending)
    EW->>PG: INSERT outbox (payload, pending)
    EW->>PG: COMMIT
    Note over EW,PG: the intent to write a vector is committed<br/>with the topic itself — atomic

    loop forever
        OW->>PG: claim outbox rows (SKIP LOCKED)
        OW->>EMB: embed
        OW->>QD: upsert vector
        alt success
            OW->>PG: status = done
        else Qdrant down
            OW->>PG: attempts += 1, keep last_error,<br/>next_attempt_at = backoff
            Note over OW,PG: the topic is NOT lost —<br/>only its searchability is delayed
        end
    end

    Note over PG,QD: a topic whose vector is still owed is invisible<br/>to Qdrant — which is exactly why resolve ALSO<br/>reads Postgres for same-name topics (P35)
```

**What to notice.** Qdrant killed mid-drain was tested: the row retried, kept its error, the worker survived, and the vector appeared on restart. Rows a dead worker stranded are reaped. Rows that exhaust their retries are dead-lettered — and reconciliation, which sweeps both directions, then carries what the fast path gave up on.

---

## 4.6 Login

```mermaid
sequenceDiagram
    autonumber
    actor U as Developer
    participant A as app
    participant S as serving
    participant PG as postgres

    U->>A: ID + password
    A->>S: POST /v1/auth/login
    S->>S: compare against .env in CONSTANT TIME
    alt match
        S->>S: sign token: v1.<payload>.<hmac>
        S-->>A: token
        A->>A: store — keychain (native) / localStorage (web)
    else no match
        S-->>A: 401 "That ID or password is incorrect."
    end

    A->>S: every later request: Authorization: Bearer <token>
    S->>S: verify signature + expiry (constant-time compare)
    S->>PG: find or create account, uid namespaced "dev:"
    S-->>A: the requested resource
    Note over A,S: a 401 signs the user out rather than<br/>leaving every screen failing silently
```

**What to notice.** Before this existed, `AUTH_MODE=dev` trusted any bearer token *as* the identity — so a login screen on top of it would have been decoration. Google sign-in becomes a second branch that yields an identity into the same `requireAccount`; nothing else changes. **Known gaps:** no rate limiting, and the web token lives in `localStorage`. This mode is for one machine and must be replaced before anything is network-reachable.
