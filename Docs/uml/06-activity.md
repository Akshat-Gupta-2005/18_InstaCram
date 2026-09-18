# 06 — Activity and decision flows

Four decisions, branch by branch. Each of these has a bug behind it: the shape of the flow *is* the fix.

---

## 6.1 The generation graph — five steps, one real branch, four endings

```mermaid
flowchart TB
    start(["topic worker claims<br/>a pending topic"]) --> fork{{" "}}

    fork --> scrape["<b>scrape</b><br/>Wikipedia, then Javadoc<br/>multi-candidate discovery<br/>+ relevance check"]
    fork --> datagen["<b>data_gen</b><br/>LLM supplementary material<br/>+ self-reported confidence"]

    scrape --> join["<b>join</b><br/><i>does nothing, and is<br/>load-bearing anyway</i>"]
    datagen --> join

    join --> grounded{"grounding.ok?"}
    grounded -->|no| unsourced["<b>unsourced</b><br/>record in unsourced_topic<br/>topic → empty"]
    grounded -->|yes| cardgen["<b>card_gen</b><br/>2–4 drafts<br/>rejects an invented source_url"]

    cardgen --> anydrafts{"any drafts?"}
    anydrafts -->|no| empty["<b>empty</b><br/>topic → empty<br/>drafts counted"]
    anydrafts -->|yes| factcheck["<b>fact_check</b><br/>each draft vs the gathered material"]

    factcheck --> verdict{"what came back?"}
    verdict -->|"at least one passed"| persist["<b>persist</b><br/>cards + quarantine + counters<br/><b>ONE transaction</b><br/>topic → ready"]
    verdict -->|"all rejected"| empty
    verdict -->|"checker errored,<br/>nothing genuinely failed"| degraded["<b>degraded</b><br/>topic stays PENDING<br/>drafts NOT quarantined"]

    persist --> done([END])
    unsourced --> done
    empty --> done
    degraded --> done

    classDef bug fill:#fee2e2,stroke:#dc2626
    class join,degraded bug
```

**Why `join` exists (P30).** LangGraph fires a node when **any** inbound edge fires, not when all of them do. With the branch hanging off `scrape` directly, routing to `unsourced` did not stop `data_gen`'s edge from firing `card_gen` — so an **ungrounded topic still produced cards**, built from LLM material with no source, and reported itself `ready`. Invariant 4 broken by orchestration while every agent behaved perfectly. The no-op node gives the branch a single place to fire from.

It was caught by a test written *because the join semantics were uncertain*, which asserts which steps did **not** run. Tests that assert absence are rare and were worth it here.

---

## 6.2 Topic resolution — the four outcomes

```mermaid
flowchart TB
    c(["candidate: name + description"]) --> lock["<b>pg_advisory_xact_lock</b><br/>hashtextextended('topic-candidate:' + name)"]
    lock --> embed["embed(name + description)<br/><i>the ONE shared embedding text</i>"]
    embed --> search["search Qdrant topic_names"]
    search --> pgread["ALSO read Postgres for same-name topics<br/><i>whose vector the outbox still owes</i>"]

    pgread --> choose{"any match ≥ 0.955?"}
    choose -->|no| create["<b>created</b><br/>INSERT topic(pending) + outbox<br/>one transaction"]
    choose -->|yes| pick["<b>chooseMatch</b> — deterministic:<br/>score, then ready, then oldest, then id"]

    pick --> what{"matched topic's status"}
    what -->|ready| reused["<b>reused</b><br/>INSERT field_topic<br/><i>cards serve immediately, zero cost</i>"]
    what -->|pending| joined["<b>joined</b><br/>INSERT field_topic<br/><i>wait for the run already underway</i>"]
    what -->|empty| requeued["<b>requeued</b><br/>the SAME row → pending<br/><i>never a duplicate</i>"]

    classDef guard fill:#fee2e2,stroke:#dc2626
    class lock,pgread,pick guard
```

**Each red box was seen failing with it removed** (P35):

| Removed | Result |
|---|---|
| the lock | 8 simultaneous requests → **8 topics** |
| the Postgres same-name read | 8 simultaneous requests → **8 topics again**, because Qdrant cannot see a vector the outbox has not written |
| deterministic `chooseMatch` | two fields link *different copies*, and the reuse guarantee stops holding without any error |

The middle row is the valuable one. With the lock held, the run took 1,433ms — the requests genuinely serialised — and *still* produced eight duplicates. That turned "a lock around a read of an eventually-consistent store serialises nothing that matters" from an argument into a measurement.

---

## 6.3 Fact-checking a long source — chunked, never truncated

```mermaid
flowchart TB
    d(["one draft card + the gathered material"]) --> size{"material length"}

    size -->|"≤ 10,000 chars"| single["<b>single pass</b><br/>whole source, one verdict"]
    size -->|"longer"| chunks["<b>split</b> into 4,000-char chunks<br/>with 800-char overlap"]

    chunks --> per["judge the draft against EACH chunk<br/>three-way verdict"]
    per --> agg{"across all chunks"}
    agg -->|"any chunk says CONTRADICTED"| fail["<b>reject</b> → rejected_draft<br/>with the checker's reason"]
    agg -->|"some SUPPORTED, none contradicted"| pass["<b>pass</b> → persist as sourced_verified"]
    agg -->|"all NOT_COVERED"| pass2["<b>pass</b><br/><i>silence is not evidence</i>"]

    single --> sv{"verdict"}
    sv -->|pass| pass
    sv -->|fail| fail
    sv -->|"unrecognised"| raise["<b>raise</b> — do NOT default to fail<br/><i>a prompt bug would otherwise quarantine<br/>every card and blame the generator (P29)</i>"]

    classDef bug fill:#fee2e2,stroke:#dc2626
    class chunks,pass2,raise bug
```

**Why this shape (P33).** Ollama defaults `num_ctx` to 4096 and **silently truncates an over-long prompt from the front** — where the card sits. The gate had been approving cards it was never shown: 11 of 20 in one run, stamped `sourced_verified`. Detection of planted errors went **0/3 → 7/7** once chunked, with faithful controls still passing.

**Why "only contradiction is decisive."** Running the single-pass prompt per chunk would reject nearly every card, because absence from one fragment is not evidence of falsehood. Silence must never reject.

**Why excerpt size and single-pass size are separate budgets** (10,000 vs 4,000): a 10k excerpt diluted attention enough that the model called an *inverted* claim "supported".

---

## 6.4 Logging a view, client-side — where two silent bugs lived

```mermaid
flowchart TB
    shown(["a card is on screen"]) --> focused{"is this screen FOCUSED?"}
    focused -->|"no — it is a stack screen<br/>the user navigated away from"| drop["<b>log nothing</b><br/><i>and stop polling</i>"]
    focused -->|yes| timer{"still there after 600ms?"}

    timer -->|"no — skipped past"| nothing["not an impression"]
    timer -->|yes| seen{"already counted<br/>this visit?"}
    seen -->|yes| nothing
    seen -->|no| buffer["buffer the view"]

    buffer --> when{"what happens next"}
    when -->|"~1s passes"| send["POST /v1/views (batched)"]
    when -->|"page hidden, refreshed<br/>or app backgrounded"| keep["POST /v1/views<br/><b>keepalive</b> — outlives the page"]
    when -->|"a new page is requested"| first["flush FIRST, then fetch<br/><i>or the server hands back<br/>cards already shown</i>"]

    send --> ok{"did it reach the server?"}
    keep --> ok
    first --> ok
    ok -->|yes| done(["user_view row — append-only, permanent"])
    ok -->|no| retry["keep it, retry on the next flush<br/><i>a dropped view corrupts the one<br/>dataset that cannot be rebuilt</i>"]
    retry --> when

    classDef bug fill:#fee2e2,stroke:#dc2626
    class focused,keep bug
```

**Both red boxes are P38**, found from one user report — "the deck always refreshes from 0".

- **Without `keepalive` and the hidden-page flush:** a refresh or closed tab runs no unmount, the buffered view dies with the page, and the server correctly hands the same card back as card 01 next visit. Reproduced: card shown 1.2s, refresh, same card returned, no request sent.
- **Without the focus check:** every feed screen ever opened stayed mounted — `Esc` pushed a *new* Home rather than going back — each keeping its keydown listener and display timer. One press of J logged a card in every hidden copy. The log holds the same card **eight times at an identical millisecond**. The account consumed a 91-card field in twenty minutes of work that displayed a handful.

The two faults corrupted the same append-only dataset in opposite directions, and neither raised an error anywhere.
