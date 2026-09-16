# FEATURES — InstaCram

Living document. Updated at the end of every working session, as part of the work. Reasoning and history live in [DECISIONS.md](DECISIONS.md).

**Last updated:** 2026-09-16 — **8d is complete, and its headline number was wrong.** Six topics measured at a **113s median** (min 92, max 128) with 6/6 `ready` and 0 zero-card topics — but the reported **0.000 rejection rate meant nothing**, because a checker that always says "pass" produces exactly that number too. Attacking the good number found **P33**: Ollama defaults `num_ctx` to 4096, nothing in the stack ever set it, and an over-long prompt is silently truncated **from the front** — where the card sits. The gate had been passing cards it was never shown, 11 of the 20 in that run, stamping them `sourced_verified`. Measured, not inferred: a 16,143-char prompt evaluates 3,613 tokens and the model can still recall a marker at the top; a 32,143-char prompt evaluates 2,050 and cannot. Fixed by chunking long sources with a **three-way per-fragment verdict where only contradiction is decisive** — the single-pass prompt run per-chunk would have rejected nearly everything, since absence from a fragment is not evidence. Detection went **0/3 → 7/7 on planted errors, with 2/2 faithful controls kept**, and `scripts/negative_control.py` now exists so a rejection rate is never quoted again without proof the gate can say no. Two follow-ons: excerpt size and single-pass size are **separate budgets** (10,000 vs 4,000 — a 10k excerpt diluted attention enough to call an *inverted* claim "supported"), and the deferred thinking-on/off question is **settled as off**, re-asked on cases that actually discriminate rather than on drafts that passed in both arms. Also surfaced: a **17% malformed-draft rate** the first summary hid behind "20 generated". Next: W5. **Earlier the same day —** **Section 8c is complete (4c.1–4c.8): generated cards now survive, and the pipeline reports on itself.** One topic goes in and comes out as 4 persisted, fact-checked, vectorised cards, with counters at `GET /metrics`. The rebuild that shipped the metrics endpoint also exposed **P32**: the pipeline container had been unstartable for days — `config.py` found the repo root by counting directory levels, which the flattened image layout breaks — and nothing caught it because the image was never rebuilt, so compose kept reporting a healthy container running *older code*. That is P22 one layer down: testing the thing next to the artefact rather than the artefact. The two tests the plan singled out both pass against the real stack: **Qdrant killed mid-drain** — the row retried, kept its error, the worker survived, and the vector appeared on restart; and a **dropped collection** rebuilt by `reindex` with search working again. Reconciliation was verified in both directions, which are deliberately asymmetric: a missing vector is re-enqueued (waste), an orphan vector is deleted (corruption). Three separate failure modes are kept distinct rather than collapsed into "no cards" — `unsourced`, `empty`, and `degraded`, the last meaning the *checker* failed and the topic is left `pending` rather than blamed. One flaky test of my own was also fixed: the concurrency assertion measured wall-clock and went red under load, so it now asserts interval overlap directly (**P31**). Next: 4c.8 (Prometheus), 8d (measure), then W5. **Earlier —** **The pipeline runs as a graph: one topic in, four fact-checked cards out, in 122s.** Sections 8a and 8b are complete (4a.1–4a.4, 4b.1, 4b.2). LangGraph was re-examined before being adopted — the agents were already orchestrated in ~30 lines of `asyncio`, and the dependency costs ~25 transitive packages — and kept deliberately, with the trade recorded. Wiring it immediately justified the scrutiny in an unexpected way: **P30**, where a conditional branch failed to skip the step it was meant to skip, because LangGraph fires a node when *any* inbound edge fires. An ungrounded topic generated cards from LLM material with **no source** and reported itself `ready` — invariant 4 broken by orchestration while every agent behaved correctly. Caught by a test written specifically because the join semantics were uncertain, asserting which steps did *not* run. Next: 8c — outbox, quarantine, counters, `reindex`. **Earlier the same day —** **W4's agents all work: one topic goes scrape → generate → write → fact-check and comes out as 4 verified cards.** Section 8a is complete (4a.1–4a.4). For `HashMap`: scraper and data-gen run concurrently in 37s, card generation returns 4 drafts with 0 malformed in 63s, and the fact-checker passes 4/4 at ~7.5s each — about **130s per topic** on a local `qwen3:8b`, the first real cost-per-topic number. A prompt bug surfaced on the first run (**P29**): the fact-checker's `verdict` key was documented only in a section the loader withholds from the model, so it invented `result` instead; a test now asserts every prompt names its own output keys. Next: 8b (graph wiring) and 8c (outbox, `reindex`, counters). **Earlier in the same day —** **W4's sourcing half: 10/10 topics grounded on the right page, the spike's headline number earned rather than assumed.** Tasks 4a.1, 4a.1b (relevance), 4a.1c (Javadoc source) and 4a.1d (section extraction) are complete. The route there is the useful part: the relevance check first dropped the score to a truthful **5/10** by refusing topics the spike had "grounded" on the wrong article; multi-candidate discovery recovered *Availability heuristic* (**6/10**); and the Javadoc source took *Java Collections* from 1/5 to 5/5 (**10/10**). Three bugs were caught along the way, each by running the thing rather than reading it: the check accepted sibling classes (**P27**), a soft 404 returned the JDK home page with HTTP 200 (**P28**), and `unsourced_topic` kept reporting five problems that a new source had already solved (migration `008`). **Earlier context:** Tasks 4a.1, 4a.1b (relevance check) and 4a.1d (section extraction) are done: on the spike's own 10 topics it grounds **5 and refuses 5**, and the 5 refusals are precisely those that would have been grounded on an article about something else. *LinkedHashMap* still grounds, on its own 424-char section of the shared page. The agent's first real run also exposed a bug in the new check itself — token containment accepted the *LinkedHashMap* section when asked for *HashMap*, and *CopyOnWriteArrayList* for *ArrayList* — fixed with a strict sibling rule and two regression tests per trap, one of which asserts the old rule **would** have accepted it so the fix cannot be quietly removed (**P27**). **The scraper spike is answered, and it turned a suspected W4 risk into a measured one.** Retrieval is fine: 10/10 topics returned usable grounding over plain HTTP in ~1.1s each, so **no browser is needed** and Playwright is not required for this source. Relevance is not: four Java topics were grounded on one *identical* article, because Wikipedia has **no page at all** for `HashMap`, `LinkedHashMap` or `ConcurrentSkipListMap` and redirects `TreeSet`/`ArrayList` to general CS concepts — so no query tuning can fix it. Recorded as **P26**, with three fixes scheduled into W4 (relevance check, second source, section extraction) and an `unsourced_topic` table (migration `007`) that records recurrences, exported to a readable JSON snapshot. Configuration became real in the same pass: one gitignored root `.env`, loaded by explicit path in both services and forwarded into containers, after five entrypoints were found resolving it against the wrong directory (**P25**). **W3 still holds: the two numbers the cache-then-generate design rests on are measured, not assumed.** The candidate generator turns a field name into described topics (156 candidates over 8 fields, 8/8 once JSON mode fixed the malformed-reply losses, P24), and a sweep over **44 hand-labelled pairs** picked **`intfloat/e5-base-v2` at threshold `0.955`** — the lowest cutoff with **zero false merges**, retaining **67% reuse**, beating MiniLM (53%), e5 with its `query:` prefix (53%) and bge (40%). **The §6.2 go/no-go passed**, so the P4 deferral stands: strict-threshold-only matching works, at a measured price of roughly a third of identical topics regenerating as duplicates. Both Qdrant collections now exist (768 dims, Cosine), closing the last W0 item, and the `embeddings` service serves e5 — verified **byte-identical** (max abs diff `0`) to the container the calibration actually ran on, so the threshold still means what the sweep said. W1/W2/W2b still hold: **23/23 tests** green, 11 tables in 6 migrations, 22/22 invariant checks, six services from one command, LLM local via Ollama (`qwen3:8b`, thinking off). Not built: the generation pipeline (W4), the cache-then-generate wiring (W5), any client (W6). **Auth is a dev stub** that trusts the bearer token as the identity. The scraper spike is blocked on a contact URL. Next: W4.

---

## 1. Status legend

| Status | Meaning |
|---|---|
| `Planned` | Agreed, not started |
| `Building` | In progress right now |
| `Done` | Implemented AND verified |
| `Cut` | Deliberately dropped — see [DECISIONS.md](DECISIONS.md) |

`Done` requires evidence — a passing test, a measured number, a working command. Nothing is marked so on the strength of code having been written; every `Done` row below points at a test, a number, or a command that was actually run.

★ marks **a non-obvious engineering decision — the part worth asking about**. One to three stars. Each starred row has a matching entry in §6.

---

## 2. Code map

### What exists today

```
18_InstaCram/
├── README.md                          what it is, how to run it, where the docs are
├── docker-compose.yml                 full local stack: postgres, qdrant, embeddings, llm-gateway, serving, pipeline
├── .env.example                       every variable with a working default; the chosen embedding model, the measured comparison table, and the calibrated threshold
├── .gitignore
├── .github/workflows/ci.yml           typecheck+test serving, ruff+pytest pipeline, migrate-twice on real Postgres
├── prompts/
│   ├── candidate-topics.md            field -> [{name, description}]; the description format is load-bearing (invariant 9)
│   ├── data-generation.md             supplementary material + self-reported confidence
│   ├── card-generation.md             2-4 cards per topic; scrape is grounding, never copied (P1)
│   ├── fact-check.md                  pass/fail + failed_claim + reason, written for the quarantine's human reader
│   └── fact-check-chunk.md            per-fragment: contradicted/supported/not_covered. Absence is NOT contradiction — the single-pass prompt run per-chunk would reject nearly every card (P33)
├── services/
│   ├── serving/                       Node 22 + Express + TS
│   │   ├── package.json, tsconfig.json, .dockerignore, vitest.config.ts
│   │   ├── tests/                     global-setup.ts (builds a fresh test DB) · helpers.ts · feed.test.ts · account.test.ts
│   │   ├── calibration/               the W3 evidence: candidates.json (156 over 8 fields) · labels.json (44 pairs, each with a `why`) · sweep-<model>.json, one per swept model
│   │   ├── Dockerfile                 migrate, then serve: `node dist/db/migrate.js && exec node dist/index.js`
│   │   └── src/
│   │       ├── index.ts               boots the app on config.port
│   │       ├── app.ts                 createApp(): /health, /v1 routes, error handler
│   │       ├── env.ts                 loads the ONE repo-root .env by explicit path; imported first by every entrypoint
│   │       ├── config.ts              page size, poll cadence, auth mode, service URLs, vector dims, match threshold
│   │       ├── types.ts               the API's response shapes
│   │       ├── http.ts                ApiError, async handler wrapper, input validation
│   │       ├── auth.ts                dev auth (token = identity); firebase mode returns 501
│   │       ├── seed.ts                fixtures incl. the shared/pending/empty/retired cases
│   │       ├── index.test.ts          /health smoke test
│   │       ├── routes/                feed.ts (feed, revision, adjacent) · account.ts (views, saves, erasure)
│   │       ├── repo/                  fields.ts · feed.ts (every read via live_scroll) · accounts.ts
│   │       ├── feed/feedService.ts    page assembly: generating / exhausted / end-card states
│   │       ├── llm/client.ts          gateway client; JSON mode + a control-char repair pass (P24)
│   │       ├── embeddings/client.ts   batched embed calls (32 at a time) + cosine
│   │       ├── topics/                candidates.ts (the LLM agent) · prompts.ts (loads prompts/*.md) · embeddingText.ts (the ONE place the embedded string is built)
│   │       ├── vectors/               collections.ts (the two Qdrant collections, create-if-missing) · ensure.ts (`npm run vectors:ensure`)
│   │       ├── calibration/           fields.ts (8 tagged fields) · generate.ts (phase A) · sweep.ts (the threshold measurement)
│   │       └── db/
│   │           ├── pool.ts            pg pool + dbHealthy()
│   │           ├── migrate.ts         forward-only runner: per-file transaction + advisory lock
│   │           ├── verify-invariants.sql  tries to break each schema invariant; 22 PASS/FAIL checks, rolled back
│   │           └── migrations/
│   │               ├── 001_init.sql   9 tables, constraints, 3 invariant triggers; unenforced invariants listed at bottom
│   │               ├── 002_quarantine_cap_20.sql  cap 5 -> 20 (P14)
│   │               ├── 003_topic_runs.sql         topic_generation_stats.runs (P16)
│   │               ├── 004_saved_scroll.sql       saves array -> saved_scroll table with real FKs (P18)
│   │               ├── 005_retire_not_delete.sql  retired_at, live_scroll view, delete-block trigger (P20)
│   │               ├── 006_account_erasure.sql    erase_account(), erasure_log (no identifier), trigger exemption (P21)
│   │               ├── 007_unsourced_topic.sql    sourcing mismatches; dedupes rather than caps (P26)
│   │               └── 008_unsourced_resolved.sql resolved_at — a stale diagnostic is worse than none
│   ├── pipeline/                      Python 3.12 + FastAPI
│   │   ├── pyproject.toml, Dockerfile, .dockerignore
│   │   ├── app/main.py                FastAPI app; GET /health only so far
│   │   ├── app/config.py              loads the ONE repo-root .env by explicit path (P25)
│   │   ├── app/relevance.py           is this article about the topic? directional token containment (P26/P27)
│   │   ├── app/sources/               base.py (the Source protocol) · wikipedia.py (direct+search, extract, sections, robots) · javadoc.py (class→package→module, deterministic URLs)
│   │   ├── app/llm.py                 gateway client; JSON mode, empty-reply guard (P23), JSON repair (P24)
│   │   ├── app/prompts.py             loads the fenced block under "## Prompt"; human reasoning never reaches the model
│   │   ├── app/agents/scraper.py      Web Scraping Agent: ground it, or refuse and record why
│   │   ├── app/agents/data_gen.py     supplementary material + self-reported confidence (4a.2)
│   │   ├── app/agents/card_gen.py     2–4 drafts; validates every field, rejects invented source_urls (4a.3)
│   │   ├── app/chunking.py            splits a long source so a prompt cannot silently overflow the window (P33)
│   │   ├── app/agents/fact_check.py   the sole quality gate; short source → 1 call, long source → chunked (P33); an unusable verdict raises, never defaults to fail (4a.4)
│   │   ├── app/graph/pipeline.py      LangGraph: 5 steps, 1 branch, 4 distinguishable outcomes; the no-op join is load-bearing (P30)
│   │   ├── app/metrics.py             Prometheus counters; rejections and checker errors stay separate on purpose
│   │   ├── app/embedding_text.py      the embedded string — a cross-service contract with serving; a mismatch silently breaks the cache
│   │   ├── app/stores/               embeddings.py (batched embed) · qdrant.py (upsert/search/scroll/delete; never creates a collection)
│   │   ├── app/repo/persist.py        topic+outbox in one txn · scrolls · quarantine · counters · status
│   │   ├── app/workers/outbox.py      drains owed vectors; retry, dead-letter, and a reaper for rows a dead worker stranded
│   │   ├── app/workers/reconcile.py   two-way sweep (missing → re-enqueue, orphan → delete) + reindex
│   │   ├── app/repo/unsourced.py      upserts unsourced_topic; dedupes, counts, never appends per run
│   │   ├── spikes/scraper_spike.py    throwaway: can we retrieve usable grounding, and by what route (P26)
│   │   ├── scripts/run_scraper.py     runs the scraping agent standalone over the spike's 10 topics
│   │   ├── scripts/run_agents.py      all four agents called directly — a failure points at one agent (8a)
│   │   ├── scripts/run_pipeline.py    one topic through the compiled graph — exercises orchestration (4b.1)
│   │   ├── scripts/run_full.py        topic → cards → persisted → vectorised, with invariant checks (8c)
│   │   ├── scripts/outbox_check.py    kills Qdrant mid-drain and drops a collection — the 4c.5/4c.7 proofs
│   │   ├── scripts/measure.py         8d: rejection rate, timings, zero-card topics, thinking A/B → measurements/*.json
│   │   ├── scripts/negative_control.py  feeds the gate KNOWN-FALSE cards — the only thing that can tell a working gate from a blind one (P33)
│   │   ├── scripts/export_unsourced.py  regenerates the JSON below from the unsourced_topic table
│   │   ├── sourcing/unsourced-topics.json  GENERATED — topics whose scrape returned the wrong article
│   │   └── tests/                     test_health.py · test_relevance.py (the sibling traps) · test_javadoc.py (the soft-404 regression) · test_llm.py · test_card_gen.py · test_prompts.py (each prompt names its own output keys) · test_graph.py (asserts which steps did NOT run) · test_chunking.py · test_fact_check.py (silence never rejects)
│   └── llm-gateway/config.yaml        LiteLLM: host Ollama, qwen3:8b with think:false (P23); num_ctx is NEVER set → 4096 (P33)
└── Docs/
    ├── BUILD-PLAN.md                  intent: stack, architecture, data model, core logic, phases, DoD
    ├── FEATURES.md                    this file — current state
    ├── DECISIONS.md                   append-only decisions log + numbered problems
    ├── IMPLEMENTATION-PLAN.md         task-level build order, W0–W7, dependencies and checkpoints
    ├── API-CONTRACT.md                the contract both clients build against
    ├── architecture-diagram.html      original planning-stage diagram; predates later changes
    ├── _plan.md                       source planning document, incl. the full reasoning trail (§10)
    ├── _Text.txt                      raw idea notes: original pitch, honest v2 rewrite, feature brainstorm
    └── _docs-generator.md             the instructions these documents follow
```

### Not yet built

The read path works end to end over seeded content, and one topic can be generated end to end. What is missing is **the join between them** — nothing yet turns a cache miss into a pipeline run. Specifically:

- **The two halves are not wired together (W5).** The feed serves what exists; the pipeline generates when asked by hand. An unknown field reports `exhausted` rather than `generating`, because no code path triggers generation. This is the single biggest gap, and 5.5 is its acceptance test.
- **Nothing persists generated cards (W4 · 8c).** The pipeline's `persist` node is a stub. No scroll rows, no outbox writes, no quarantine rows, no counters, no outbox worker, no reconciliation, no `reindex`.
- **The vector write and search path does not exist (task 3.4).** Both Qdrant collections are created and correctly configured, and the embedding call works — but nothing writes a topic vector or searches one, so cache lookup cannot happen yet.
- **No clients.** Framework not confirmed (§6).
- **No K8s manifests, no Grafana dashboards, no E2E suite** (W7).
- **Auth is a dev stub.** `AUTH_MODE=dev` trusts the bearer token as identity until Firebase credentials exist (task 2b.1).
- **No CI run has ever happened.** `ci.yml` exists, but the project is not under git. It is not a passing pipeline; it is an unexecuted one — which is how a broken `pip install -e .` survived unnoticed until it was tripped over locally.

The rest of the proposed layout is in [BUILD-PLAN.md](BUILD-PLAN.md) §6.

### Central pipeline — the request path, traced end to end

The path a single field-of-interest request takes. **`built` means the code exists and has been run; `planned` means it does not exist yet.** Steps 4, 5a and 5b are the join between the two halves, and are what W5 delivers.

| Step | File | State | What happens |
|---|---|---|---|
| 1 | `services/serving/src/routes/feed.ts` | **built** | Client POSTs a field name. |
| 2 | `services/serving/src/feed/feedService.ts` | **built** | Feed Orchestrator assembles a page: unviewed scrolls, the `generating` flag, or the end-of-field card. |
| 3 | `services/serving/src/topics/candidates.ts` | **built** | Candidate Topic Generator (LLM) turns the field name into candidate topic names **plus a one-line description each**. The description is both the query text and, on a miss, the stored one. |
| 4 | `services/serving/src/topics/lookup.ts` | planned (3.4) | `embed(name + description)` is searched against the Topic-Name Vector DB at threshold `0.955`. A topic with `status = 'empty'` counts as a **miss**. **The branch point.** |
| 5a | `services/serving/src/topics/reuse.ts` | planned (5.3) | **MATCH** → write one `Field_Topic` row, fetch the topic's existing scrolls, serve them. Pipeline never runs. |
| 5b | — | planned (5.4) | **NO MATCH** → trigger the generation graph for that topic, asynchronously. |
| 6 | `services/pipeline/app/agents/scraper.py` | **built** | Web Scraping Agent (non-LLM, plain HTTP) returns grounding + source URL, **or refuses**. Runs concurrently with step 7. |
| 7 | `services/pipeline/app/agents/data_gen.py` | **built** | LLM Data-Generation Agent produces supplementary material + confidence. Runs concurrently with step 6. |
| 8 | `services/pipeline/app/agents/card_gen.py` | **built** | Card Generation LLM combines both into 2–4 draft cards. Generated prose, never the scrape verbatim. |
| 9 | `services/pipeline/app/agents/fact_check.py` | **built** | Fact-Check Agent verifies each draft against the gathered material. |
| — | `services/pipeline/app/graph/pipeline.py` | **built** | Orchestrates 6–9 with the fact-check branch and four distinguishable outcomes. |
| 10a | `services/pipeline/app/stores/quarantine.py` | planned (4c.2) | **FAIL** → draft goes to `Rejected_Draft` with its reason, counters increment. No retry. If no draft survives, `Topic.status = 'empty'`. |
| 10b | `services/pipeline/app/stores/persist.py` | planned (4c.1) | **PASS** → write scroll to Postgres, embed into Scroll-Content VDB, link `Field_Topic`, set `Topic.status = 'ready'`. |
| 10c | `services/pipeline/app/outbox/worker.py` | planned (4c.5) | The topic's Topic-Name vector is written by the outbox worker, not inline — the outbox row was committed in the same transaction as the topic. |
| 11 | `services/serving/src/routes/account.ts` | **built** | As each card is displayed, one `User_View` row is written — and it is also the feed's paging mechanism (§4.4). |

---

## 3. Features

Grouped in dependency order: data layer first, then the paths that depend on it.

### 3.1 Data layer — foundations

| Feature | Status | What it does | Lives in | Star |
|---|---|---|---|---|
| Postgres schema | `Done` | 11 tables and the `live_scroll` view, applied by 6 migrations. **All 22 invariant checks pass** against Postgres 16: field-name dedup, polysemous topics coexisting, junction uniqueness, provenance/trust-label/status constraints, description immutability, append-only `user_view`, the quarantine cap, saves (foreign key and idempotency), retire-not-delete (a delete is rejected; a retired card leaves `live_scroll` and keeps its views and saves), and account erasure (checks 10a–10d). Invariant 8 became enforceable in `004`, invariant 12 was added in `005`, and invariant 13 in `006`. Invariants 5, 6 and 11 still aren't enforceable in the database; they're listed at the bottom of `001_init.sql`. | `services/serving/src/db/migrations/` | |
| Migration runner | `Done` | Forward-only. Each file and its bookkeeping row commit as one transaction (P15), and runs are serialised by an advisory lock. Verified: a second run reports "no pending migrations"; with the lock held elsewhere the runner waited and finished in 7.6s vs ~1.4s unblocked; of two runners started together, one applied and one found nothing pending. It runs automatically before the server on every serving start, and every failure is logged with a `MIGRATION FAILED` prefix (P22). | `services/serving/src/db/migrate.ts` | |
| `Field_Topic` junction table | `Done` | Many-to-many link making a topic independent of any field. One row is the entire cost of surfacing an existing topic under a new field. **Proved with no AI involved:** an integration test serves one topic's cards under two fields from a single topic row. The junction is also what ranks adjacent fields by shared topics — a third use of the same table. | `services/serving/src/db/migrations/001_init.sql` | ★★★ |
| Topic-Name Vector DB | `Planned` (collection exists) | Qdrant collection, `{ topic_id, embed(name + description) }`. The description is the candidate generator's one-liner, so query and index vectors come from the same producer — symmetric by construction. Resolves P9. Created at **768 dims / Cosine**, matching the calibrated model; Cosine because the threshold was measured on cosine similarity and another metric would make `0.955` meaningless. Writing and searching it is task 3.4, carried into W4. | `services/serving/src/vectors/collections.ts` | ★★ |
| Scroll-Content Vector DB | `Planned` (collection exists) | Qdrant collection, `{ scroll_id, topic_id, content embedding }`. Written per card; **nothing reads it in v1** — it exists so "more like this" and semantic search are possible later without re-embedding the whole corpus. Created at 768 dims / Cosine. Separate from the Topic-Name collection on purpose: merging them would tie a hot dedup path to a cold search index. Writes land in task 4c.1. | `services/serving/src/vectors/collections.ts` | |
| Transactional outbox + worker | `Done` | `Topic` row and `Outbox` row commit in one Postgres transaction; a worker drains it into Qdrant with bounded retry, then dead-letters. **Proved by killing Qdrant mid-drain**: the row retried with its error recorded, the worker survived, and the vector appeared on restart. Three distinct failures are handled separately — Qdrant down (retry), poisoned row (dead-letter), and **worker death mid-row**, which would otherwise strand a row in `processing` forever; a reaper returns those to the queue. Resolves P11. | `app/workers/outbox.py` | ★★ |
| Two-way reconciliation check | `Done` | Safety net behind the outbox, and the two directions get **opposite** treatment: a topic with no vector is re-enqueued (waste, recoverable), a vector with no topic is deleted (corruption, not self-correcting). It also revives dead-lettered rows, which is what makes bounded retry safe rather than lossy. Verified both directions. | `app/workers/reconcile.py` | |
| `reindex` command | `Done` | Rebuilds both Qdrant collections from Postgres. Verified by **dropping a collection** and rebuilding: 8 topic vectors + 12 scroll vectors, search working afterwards. Built early and independently of P11 — the first embedding-model change invalidates every vector, and this is the only way back. Reads `live_scroll`, so retired cards do not return through semantic search either. | `app/workers/reconcile.py` | |

### 3.2 Serving path

| Feature | Status | What it does | Lives in | Star |
|---|---|---|---|---|
| Feed Orchestrator | `Building` | Handles a field request end to end: candidate generation, lookup, streaming. The only component that knows the whole request story. | `src/feed/feedService.ts`, `src/repo/feed.ts` | |
| Candidate Topic Generator | `Done` | LLM agent: field name → candidate topic names **+ a one-line description each**. Lives in the *serving* service, not the pipeline, because it runs on every request including pure cache hits. Measured: 156 candidates over 8 fields, 8/8 fields parsing cleanly once JSON mode landed. Not yet wired into a feed request — that is W5. | `src/topics/candidates.ts`, `src/topics/prompts.ts` | |
| Topic cache lookup (strict threshold) | `Planned` | Searches `embed(name + description)` at a strict similarity threshold; `status = 'empty'` topics count as misses. Biased toward regenerating a duplicate rather than risking a false merge. **Threshold chosen and measured: `0.955` on `intfloat/e5-base-v2`** — the lowest value with zero false merges over 44 labelled pairs, keeping 67% reuse (§4). The collections and the embedding call exist; the search itself is W3.4, still open. | `src/topics/`, `src/vectors/collections.ts` | ★★★ |
| Topic reuse on match | `Planned` | On a hit: one junction row, zero LLM calls, zero scrapes, existing scrolls stream immediately. | `services/serving/src/topics/` | ★★ |
| Paginated feed + prefetch | `Done` | ~10 scrolls per page; client requests the next page at ~3 remaining. Stateless per request, one transport, no SSE — React Native has no native `EventSource`. | `src/feed/feedService.ts`, `src/repo/feed.ts` | |
| Paging by view exclusion | `Done` | "Next page" = scrolls this user has not viewed. No cursor to invalidate when a field gains topics, no repeats across sessions or devices. Makes `User_View` load-bearing for correctness. | `src/feed/feedService.ts`, `src/repo/feed.ts` | |
| Partial page + `generating` flag | `Done` | On a cold field the page returns whatever cleared fact-check — possibly zero — plus `generating: true`; client re-polls until it clears. Waiting state appears only once partial cards are exhausted. Preserves stream-on-pass intent without a second transport. Resolves P13. | `src/feed/feedService.ts`, `src/repo/feed.ts` | ★★ |
| End-of-field card | `Done` | `exhausted: true` when no unviewed scrolls remain; one terminal card offering more topics, revision, or adjacent fields. **The feed never silently loops** — that is the engagement pattern P8 excluded streaks to avoid. | `src/feed/feedService.ts`, `src/repo/feed.ts` | ★★ |
| Topic expansion (user-triggered) | `Planned` | Re-runs the candidate generator with existing topic names as exclusions, aiming into the field's tail. Only on an explicit tap, so cost is per-request rather than per-exhausted-user. | `services/serving/src/topics/` | |
| Revision mode | `Done` | Viewed scrolls, oldest `viewed_at` first. Approximates spaced repetition without a scheduler, and does not pretend to be the deferred confidence-based version. | `src/feed/feedService.ts`, `src/repo/feed.ts` | |
| Adjacent-field suggestions | `Done` (overlap half) | Ranked by shared topics via `Field_Topic` — one SQL query, no LLM — with an LLM suggestion filling in when overlap is thin. A third use of the junction table. | `src/feed/feedService.ts`, `src/repo/feed.ts` | |

### 3.3 Generation pipeline

| Feature | Status | What it does | Lives in | Star |
|---|---|---|---|---|
| LangGraph pipeline definition | `Done` | 5 steps, 4 agents, one real branch at fact-check. Runs end to end: `HashMap` → `ready`, 4 drafts, 4 passed, 121.9s. **Four outcomes stay distinguishable** — `ready`, `unsourced`, `empty`, `degraded` — because "no cards" has three different causes and only one is the topic's fault. The no-op `join` node is load-bearing: LangGraph fires a node when *any* inbound edge fires, so without it an ungrounded topic still generated cards (P30). | `app/graph/pipeline.py` | ★★ |
| Web Scraping Agent | `Done` | **Plain HTTP, no browser** — the spike settled that Playwright is unnecessary for these sources. Topic → grounding text + source URL, **or an explicit refusal**. Two axes of fallback: several candidate titles within a source (direct lookup *and* search, since each finds topics the other misses), then across sources. 10/10 on the benchmark. | `app/agents/scraper.py`, `app/sources/` | ★★ |
| Relevance check | `Done` | Is the retrieved page about the topic at all? Directional token containment — deterministic, no threshold to calibrate. Refuses the 6 measured mismatches, keeps the 4 measured matches. **Section headings use a stricter sibling rule**, since sections of one article are confusable peers where a longer name means a *different* class (P27). Known limitation, asserted by a `strict` xfail: abbreviations share no tokens with their expansion. | `app/relevance.py` | ★★★ |
| Javadoc source | `Done` | The second source, for classes an encyclopedia has no page for. **Discovery is deterministic** — class → package → module → exactly one URL — so the wrong-article failure cannot occur here at all. Took *Java Collections* from 1/5 to 5/5. Beware the soft 404: the module-less URL answers `200` with the JDK home page (P28). | `app/sources/javadoc.py` | ★★ |
| LLM Data-Generation Agent | `Done` | Fills gaps the scrape misses, with self-reported confidence. No data dependency on the scraper — the two run concurrently, which is the main parallelism in the pipeline, asserted in tests and measured at 37s for the pair. Anything not exactly `high` is treated as low, so an invented third value cannot read as confident. | `app/agents/data_gen.py` | |
| Card Generation LLM | `Done` | 2–4 one-page drafts from both inputs; 4 drafts, 0 malformed on the first real run. Validates every field in the agent rather than at the database, and **rejects a `source_url` the generator invented** — a fabricated link looks like provenance, and that link is the user's only way to check a fact (invariant 4). | `app/agents/card_gen.py` | ★ |
| Fact-Check Agent | `Done` | Sole quality gate. An unrecognised verdict **raises rather than defaulting to fail** — needed on the very first run, when a prompt bug (P29) would otherwise have quarantined every card and marked the topic `empty` while the counters blamed the generator. **A source longer than one context window is chunked, not truncated** (P33): it was passing long-source cards it had literally never been shown, because Ollama silently drops the front of an over-long prompt and the card is at the front. Per fragment the verdict is three-way and **only contradiction is decisive** — silence never rejects, or every card would fail on the fragments that simply do not mention it. | `app/agents/fact_check.py` · `app/chunking.py` | ★★★ |
| Fact-check negative control | `Done` | The only test that can tell a working gate from a blind one. Plants known-false claims — reversed directions, wrong figures, wrong attributions — in cards built on real grounding, alongside faithful controls that must still pass. Wrote itself into existence: a 0.000 rejection rate over 20 drafts was indistinguishable from a checker that always says yes, and the control showed **0/3 caught** on long sources. Run it after any change to a prompt, a model, or a context budget. | `scripts/negative_control.py` | ★★★ |
| Fact-check counters | `Done` (Prometheus pending) | `topic_generation_stats` — drafts generated / passed / failed per topic, incremented by the pipeline in the same transaction as the cards and quarantine rows, so the numbers can never disagree with what was actually written. Verified: a run of 4 passing drafts recorded `generated 4 / passed 4 / failed 0 / runs 1`. `runs` increments per run, so `runs > 1` means the topic came back empty and was retried. The Prometheus counter (4c.8) is still to come. | `app/repo/persist.py` | |
| Quarantine writes | `Done` | Failed drafts land in `rejected_draft` with the checker's specific reason, capped at 20 per topic by trigger. **A checker that errored is not a rejection:** those drafts are left alone and the topic stays `pending`, because recording them as failures would report a 100% rejection rate and send someone to fix the generator (P10, P29). | `app/repo/persist.py`, `app/graph/pipeline.py` | |
| `Topic.status` (`pending`/`ready`/`empty`) | `Planned` | Makes the zero-card topic representable **and** makes the lookup treat it as a miss. Without it a topic whose drafts all failed is cached and re-served as a successful hit forever. Resolves the sharper half of P10. | `services/serving/src/db/` | ★★ |
| `Rejected_Draft` quarantine | `Planned` (table exists) | Keeps the last **20** rejected drafts per topic with reasons — raised from 5 in migration `002` after tied timestamps made the cap keep arbitrary rows (P14). An over-strict checker and a bad generator produce the identical rejection number; only the text separates them. It is also the evidence the deferred no-retry decision is waiting on. Separate table, never a flag on `Scroll` (invariant 10). The schema and its cap are built and verified; the pipeline writing to it is task 4c.2. | `services/pipeline/app/stores/` | |
| LiteLLM gateway | `Done` | One OpenAI-compatible endpoint for both services, so the model is a config value. **Points at Ollama on the host** (`qwen3:8b` with `think: false`, fallback `qwen2.5-coder:7b`) — no API key, no per-call cost. Verified: a real completion returns clean text, a strict-JSON prompt parses first try, and both `serving` and `pipeline` reach it over the private network. All five agents now call it in anger — candidate generation, data-gen, card-gen and fact-check — with JSON mode constraining the decoding. **Its health endpoint is not a readiness signal:** `/health/liveliness` returns `200` while a dead Ollama returns `500` and a missing model `404` on the actual completion path. Check with `ollama list`. | `services/llm-gateway/config.yaml` | |

### 3.4 Account and retention

| Feature | Status | What it does | Lives in | Star |
|---|---|---|---|---|
| Firebase Auth login/signup | `Building` | Managed auth. Independent of the entire feed path — buildable and testable with no pipeline in existence. | `src/routes/account.ts`, `src/repo/accounts.ts` | |
| Bookmark / save to revision pile | `Done` | `saved_scroll` table (account, scroll, saved_at) with real foreign keys, mirrored to client local storage for offline and instant access. Schema exists; the endpoints don't. |
| Account erasure (`DELETE /v1/account`) | `Done` | Removes the account, its view history and its saves in one transaction via `erase_account()`, deletes the Firebase Auth user, and writes an audit row with counts but no identifier. It's the only path allowed to remove view history. The database side exists (migration `006`); the endpoint doesn't. | `src/routes/account.ts`, `src/repo/accounts.ts` | | `src/routes/account.ts`, `src/repo/accounts.ts` | |
| View logging | `Done` | One `User_View` row per **displayed** card — never per fetched card, which prefetch makes a different number (P12). Built before it had a consumer because view history is the only data that cannot be backfilled; it since acquired one early, as the feed's paging mechanism. | `src/routes/account.ts`, `src/repo/accounts.ts` | ★★ |
| Self-hosted embedding service | `Done` | Hugging Face text-embeddings-inference, pinned to `cpu-1.9.3` (P19); the highest-volume model call in the system. Verified: ready 289s after a clean start (a one-time model download, cached in a volume afterwards), and `"HashMap"` embeds to a 768-dim vector with the default `bge-base-en-v1.5`. The model itself is still provisional; the W3 comparison picks it. | `docker-compose.yml` (`embeddings`) | |

### 3.5 Card content — the MVP six

All six are in the MVP because each is a near-free schema field now and expensive to retrofit once a content corpus exists.

| Feature | Status | What it does | Lives in | Star |
|---|---|---|---|---|
| Visible source link per card | `Planned` | `Scroll.source_url`, non-null. Doubles as attribution and as the user's only means of checking a fact they half-remember. | schema + client | |
| Content trust label | `Planned` | `Scroll.trust_label`, non-null. Distinguishes sourced/verified from AI-generated-unreviewed. | schema + client | |
| Tap-to-reveal recall prompt | `Planned` | One question per card, answer hidden until tapped. Converts passive viewing into active recall — without it the "revision tool" claim has nothing behind it (P2). | schema + client | ★ |
| "Why this matters" one-liner | `Planned` | One line per card tying the concept to a real situation. Generalises the origin story: a fact sticks better attached to a reason. | schema + client | |
| One-page format constraint | `Planned` | No scrolling within a card. Enforced at generation time by the card generator's prompt. | `services/pipeline/app/agents/` | |
| Flat, field-scoped feed | `Planned` | No prerequisite ordering, no curriculum. A deliberate scope boundary, not a missing feature (P6). | `src/feed/feedService.ts`, `src/repo/feed.ts` | |

### 3.6 Infrastructure and quality

| Feature | Status | What it does | Lives in | Star |
|---|---|---|---|---|
| Local stack via Docker Compose | `Done` | 6 services, no cloud account needed, one command: `docker compose up -d --build`. **All 6 healthy:** serving and pipeline `/health` report `db: ok`, Qdrant passes `/healthz`, the gateway is alive, Postgres passes its healthcheck, and embeddings returns a 768-dim vector. Serving migrates itself before it listens. An empty database reached 12 base tables with no manual step, and an unreachable database stopped the server from starting, logging `MIGRATION FAILED` (P22). Caveat: verified on this machine, not yet from a literal fresh clone on a second one, because the project isn't in git. | `docker-compose.yml` | |
| K8s manifests | `Planned` | Identical manifests for GKE and a local `kind` cluster, so the zero-cost fallback is not a different system. | `infra/k8s/` | ★ |
| GitHub Actions CI | `Building` | Workflow written: typecheck+test serving, ruff+pytest pipeline, and migrate-twice on a real Postgres service container. **Never run on GitHub**, because the project isn't a git repository yet. Each step has passed locally. | `.github/workflows/ci.yml` | |
| Prometheus metrics (pipeline) | `Done` | `GET /metrics` on the pipeline, verified from the rebuilt container. **Rejections and checker errors are separate counters, never summed** — they are identical in one number and need opposite responses (P10, P29). Outcomes are labelled `ready`/`unsourced`/`empty`/`degraded` rather than collapsed. Duration buckets reach 600s, because Prometheus' defaults top out at 10s and would file every run of a ~120s local model in `+Inf`. | `app/metrics.py` | |
| Grafana dashboards | `Planned` | The two services fail differently, so serving latency and pipeline throughput need separate panels. Serving has no `/metrics` endpoint yet. | `infra/grafana/` | |
| Test suites | `Building` | **103 automated checks passing**: 23 serving integration tests against a real Postgres, 80 pipeline tests (+1 `strict` xfail that asserts a known limitation still exists), and 22 schema-invariant checks. Several are written as regressions for bugs that had already shipped — the sibling traps (P27), the soft 404 (P28), each prompt naming its own output keys (P29), and which graph steps did **not** run (P30). Still missing: E2E covering field request → feed render → bookmark → reload, which waits on a client. | `services/*/tests/`, `verify-invariants.sql` | |

### 3.7 Deferred and cut

| Feature | Status | Note (why deferred or cut, what would change it) |
|---|---|---|
| Meaning-disambiguation in topic matching | `Planned` (deferred) | Two-stage match is fully specified in [BUILD-PLAN.md](BUILD-PLAN.md) §4.2. Added only when bad merges are actually observed on real data — see P4. |
| Big / multi-step topics | `Planned` (deferred) | Do not reduce to one page without being mutilated. Phase 2. Would need a multi-card or depth-variant content model — P5. |
| Topic sequencing / prerequisites | `Planned` (deferred) | A curriculum graph is a different product. Also conflicts directly with stream-on-pass ordering, so adding it means revisiting that decision too — P6. |
| Confidence-based resurfacing | `Planned` (deferred) | Blocked on nothing technical — the view log (§3.4) is being built specifically so this is possible later. High priority post-MVP. |
| User flagging of incorrect cards | `Planned` (deferred) | High priority post-MVP. Second line of defence behind the fact-checker. |
| Direct search bar | `Planned` (deferred) | High priority post-MVP. The Scroll-Content VDB is being populated in v1 partly so this needs no backfill. |
| Request-a-topic | `Planned` (deferred) | High priority post-MVP; helps cold-start in niche fields. |
| Multi-field blended feeds | `Planned` (deferred) | High priority post-MVP. The junction table already supports it structurally. |
| Depth / explanation-style toggle | `Planned` (deferred) | v2. Needs multiple content variants per topic — a real generation-cost multiplier, not a UI switch. |
| "More like this" branching | `Planned` (deferred) | v2. Effectively the sequencing model in disguise. |
| Dashboard / coverage map, weekly recap | `Planned` (deferred) | v2. Depends on the view log accumulating first. |
| Feed from a pasted job description | `Planned` (deferred) | v2. Strong narrative fit — it is the origin story as a feature — but a separate parsing pipeline, not a small addition. |
| TTS narration, auto-generated diagrams | `Planned` (deferred) | Low priority. |
| Offline packs, multi-language, home-screen widget | `Planned` (deferred) | Low priority. |
| Trending-within-field | `Planned` (deferred) | Meaningless without a user base. |
| **Streaks / daily goals** | `Cut` | Directly contradicts the project's own motivation. Not deprioritised — excluded, so that adding it later requires an argument. See P8. |
| **Followed / curated feeds, community voting** | `Cut` | Converts a personal tool into a multi-user content platform with moderation and trust problems. A pivot, not a toggle. |
| **Serving scraped content verbatim** | `Cut` | Republishing problem. Scrape is grounding context only — P1. |
| **Retry / re-queue on fact-check failure** | `Cut` | v1 deletes outright. Revisit only if the rejection counter (§3.3) shows the rate justifies the machinery. |
| **"Subconscious learning" as a product claim** | `Cut` | Not supportable — fluency illusion. Replaced by priming + revision, and by the recall prompt as an actual mechanism. P2. |

---

## 4. Current state / measured results

First observed results, 2026-09-11, on Windows 10 with Docker Desktop (engine 29.7.2), Node 22 and Python 3.11/3.12. Everything below was actually run; nothing is estimated.

| What | Result | Reproduce |
|---|---|---|
| Schema invariants | **22 / 22 PASS** | `docker cp services/serving/src/db/verify-invariants.sql instacram-postgres-1:/tmp/v.sql && docker exec instacram-postgres-1 psql -U instacram -d instacram -q -f /tmp/v.sql` |
| Migration repeatability | 001–006 each applied once as written; every re-run reported `no pending migrations` | `cd services/serving && npm run migrate` twice |
| Advisory lock blocks | 7.6s with the lock held elsewhere vs ~1.4s unblocked | Ad-hoc script, **not yet committed** (see §7) |
| Concurrent runners | 1× `3 migration(s) applied`, 1× `no pending migrations`, both exit 0, 3 rows recorded | Same ad-hoc script |
| Serving | `tsc --noEmit` clean; **23/23 tests pass** in ~17s across 3 files (13 feed, 9 account, 1 health), against a real Postgres built by the same migration runner the container uses | `cd services/serving && npm run typecheck && npm test` |
| Seed | 4 fields, 7 topics, 8 links, 13 cards (12 live, 1 retired) | `cd services/serving && npm run seed` |
| Feed through the container | Page of 3 → 2 more with **0 repeats** → exhausted, `viewed_count: 5`, offering *Java Collections (shares 1)*. A pending field returned `generating: true`, `topics_pending: 1`, `failed_topics: [Lazy Evaluation]` | `POST localhost:3000/v1/feed` with `Authorization: Bearer demo` |
| Candidate generation | 18–20 topics per field in 32–54s each on `qwen3:8b`; **8/8 fields parsed** once JSON mode was requested (6/8 before, P24). 156 candidates over 8 fields | `npm run calibrate:generate` |
| Threshold calibration | 44 hand-labelled pairs (15 same-concept, 28 different) over those candidates. Lowest threshold with **zero false merges**, and the reuse retained at it: **e5-base-v2 → 0.955, 67%**; MiniLM-L6-v2 → 0.830, 53%; e5 *with* its `query:` prefix → 0.955, 53%; bge-base-en-v1.5 → 0.930, 40%. No model separates the two groups perfectly, which the design expects and accepts | `npx tsx src/calibration/sweep.ts --url <server> --label <model>` |
| Scraper sourcing (spike) | **Retrieval: 10/10 usable** over plain HTTP with no browser — median 22,816 chars, median 1.1s, so Playwright is not needed for this source. **Relevance: much worse than that number implies.** Four Java topics (*TreeSet*, *ArrayList*, *ConcurrentSkipListMap*, *LinkedHashMap*) all matched one identical article, *Java collections framework*, byte-identical at 22,789 chars; *HashMap* matched *Hash table* rather than the Java class. All 5 Behavioural Economics topics matched well (4 exact, 1 generic). The spike's 500-char success test cannot tell "usable text" from "text about the right thing" | `cd services/pipeline && .venv/Scripts/python spikes/scraper_spike.py` (requires `SCRAPER_CONTACT`) |
| Web Scraping Agent (4a.1/b/c/d) | Same 10 topics the spike scored 10/10 on: **10 grounded, 0 refused — and this one is real.** Four Java classes come from Javadoc at 2,016–4,768 chars each (*Java Collections* went **1/5 → 5/5**), *LinkedHashMap* from its own 424-char Wikipedia section, and all 5 Behavioural Economics topics from their own articles. *Availability heuristic* was recovered by adding direct-title lookup alongside search. Progression worth keeping: **5/10 → 6/10** (multi-candidate) **→ 10/10** (Javadoc). `unsourced_topic` now reports **0 open, 6 resolved** | `cd services/pipeline && .venv/Scripts/python scripts/run_scraper.py` |
| All four agents, one topic end to end | `HashMap` / *Java Collections*: scraper + data-gen **concurrently in 37s**, card generation **4 drafts, 0 malformed, in 63s**, fact-check **4/4 pass** at ~7.5s each. The four cards cover genuinely distinct aspects (bucket structure, complexity, load factor, thread safety), each with the correct `source_url`. Roughly **130s per topic** on a local `qwen3:8b` — the first real cost-per-topic figure, and the one that decides whether the cache hit rate is a nice property or load-bearing | `cd services/pipeline && .venv/Scripts/python scripts/run_agents.py` |
| The graph, end to end (4b.1/4b.2) | `HashMap` through the compiled LangGraph: **outcome `ready`, 4 drafts, 4 passed, 0 failed, 0 malformed, 0 checker errors, 121.9s.** Concurrency asserted in tests with 50 ms stubs — sequential ≥100 ms, actual under 90 ms | `cd services/pipeline && .venv/Scripts/python scripts/run_pipeline.py` |
| Outbox, reconciliation, reindex (4c.4–4c.7) | **17/17 integration checks against the real stack**, including the two the plan singles out. Qdrant killed mid-drain: the row retried, kept its error, and the worker survived; restarted, the vector appeared and the row went `done`. A dead-lettered row was revived by reconciliation and its vector came back. An orphan vector was detected and deleted. The collection was **dropped**, and `reindex` rebuilt 8 topic vectors + 12 scroll vectors from Postgres with search working again (top score 0.7609) | `cd services/pipeline && .venv/Scripts/python scripts/outbox_check.py` |
| One topic, generated and persisted (8c) | `HashMap`: topic + outbox row in one transaction, **4 scrolls persisted**, 0 quarantined, counters `generated 4 / passed 4 / failed 0 / runs 1`, `status='ready'`, topic vector present after one drain. All four invariant checks pass — provenance on every card, exactly one vector, zero-cards-implies-empty, and counters matching what was actually written | `cd services/pipeline && .venv/Scripts/python scripts/run_full.py` |
| Pipeline | `ruff` clean; **85 passed, 1 xfailed** (the xfail is `strict` — it asserts the abbreviation limitation still exists) | `cd services/pipeline && ruff check . && pytest` |
| Stack health | **6 / 6 services healthy.** Embeddings ready 289s after a clean start; `"HashMap"` → 768-dim vector | `docker compose up -d --build`, then each `/health`, then `POST localhost:8081/embed` with `{"inputs":"HashMap"}` |
| Clean-database migration | Empty database → `6 migration(s) applied` → 12 base tables, done by the serving image alone | `docker compose run --rm --no-deps -e DATABASE_URL=<empty db> serving node dist/db/migrate.js` |
| Migrate-before-serve | Unreachable database → exit 1, `MIGRATION FAILED: getaddrinfo ENOTFOUND …`, and the server never listens | `docker compose run --rm --no-deps -e DATABASE_URL=<unreachable host> serving` |
| Gateway → host Ollama | Warm call **3s**; **160s** when the model had been evicted from memory and had to reload. A strict-JSON prompt parsed first try: 2 topics, 39 completion tokens, no code fences | `POST localhost:4000/v1/chat/completions` with `{"model":"default","messages":[…]}` |
| Services → gateway | `serving` and `pipeline` both receive `"I'm alive!"` over the private network | `docker compose exec serving wget -qO- http://llm-gateway:4000/health/liveliness` |

The serving tests are real integration tests against a live database rather than mocks, which is the only way to test rules that live in SQL and triggers. They cover cross-field reuse, view-exclusion paging, the end-of-field card, generating versus exhausted, revision ordering, saves and erasure. The pipeline's single test is still a placeholder.

The numbers this section should carry next, once W2–W5 land:

| Metric | How it will be measured | Current value |
|---|---|---|
| Cache hit rate on candidate topics | Proportion of candidates matching an existing topic, per field request | not measured |
| Pipeline latency, single topic | Wall clock, scrape start → first card streamed | **113s median** over 6 topics (min 92, max 128); `measurements/20260916-061312.json` |
| Time to first card on a cache hit | Wall clock, request → first card rendered | not measured — W5 |
| Fact-check rejection rate | Fail count ÷ draft count, per topic (see P10) | **0/9 on the drafts actually checked.** The run's headline `0.000 over 20` is **withdrawn**: 11 of those drafts were never shown to the gate (P33). Too small to settle P10; re-measure now the gate works |
| Malformed draft rate | Drafts the generator returned that fail validation ÷ drafts attempted | **4/24 (17%)** — 3 of them on TreeSet alone, which yielded 1 usable card from 4 |
| Planted-error detection | Known-false claims the gate catches ÷ planted, with faithful controls that must pass | **7/7 caught, 2/2 controls kept**; `scripts/negative_control.py`. Was 0/3 on long sources before P33 |
| Fact-check cost per card | Model calls per verdict | **1** where the source fits one window. **Up to 11** on a 32k-char source — a pass must rule out a contradiction in *every* excerpt (132s); a rejection short-circuits at the first one (17s) |
| Topics with zero surviving cards | Count of topics where every draft failed | **0 of 6** |
| Test count and pass rate | CI output | **120 passed, 1 xfailed** locally (pipeline). **CI has still never run** — the repo only recently came under git, and an un-run CI file is not a passing one |

The two external figures quoted in [BUILD-PLAN.md](BUILD-PLAN.md) — EKS ~$0.10/hr control-plane fee, GKE $74.40/month credit — come from a pricing check made during planning, not from this project's own billing. They are vendor pricing and should be re-checked before the GKE decision is acted on.

---

## 5. Interview talking points

One entry per starred feature, strongest first.

### ★★★ Topic identity is decoupled from field, so content is reused instead of regenerated

Topics live in their own table and are joined to fields through a `Field_Topic` many-to-many junction. A topic is never owned by the field that first requested it.

The naive design makes the cache key `(field, topic)`, because that is how the user experiences it — you ask for a field, you get its topics. That quietly means "HashMap" requested under *Java Utils* and again under *Java Collections* runs the full scrape → generate → fact-check pipeline twice and produces two near-identical topics. The expensive artifact is the topic's content, and the field is not part of that content's identity, so the field should not be in the cache key. Once the junction table exists, surfacing an existing topic under a new field costs exactly one row.

*Why is the reuse per-topic and not per-field?* Because per-field caching only helps someone requesting the same field twice, which is the rare case. Per-topic caching helps every field that overlaps with any field ever requested, which is the common one — fields overlap heavily and users do not coordinate their phrasing. Concretely: *Java Collections* arrives after *Java Utils* already exists, the vector lookup hits on HashMap, one junction row is written, its three existing cards appear under the new field for free, and only the genuinely new candidates like TreeSet run the pipeline. Full reasoning in P3.

### ★★★ The matching threshold is tuned toward wasting money rather than being wrong

Topic reuse matches candidate names by embedding similarity against a strict threshold, with no disambiguation stage — deliberately, and with the fuller solution already specified and deferred.

The trap is that name-embedding similarity is not concept equivalence. "Stack" under a Web Development field means a technology stack; under a DSA field it means the data structure. Same string, near-identical embedding, unrelated concepts. The obvious instinct is to build the correct thing straight away: coarse retrieval by name, then a second-stage LLM or description-embedding check confirming genuine equivalence before reuse is allowed. That is the right long-term design and it is written down. It was still not built.

*Why ship the version you know is wrong?* Because the two failure modes have wildly asymmetric costs, and the cheap one can be chosen on purpose. A **false merge** silently serves DSA content under a Web Development field, produces no error, and is only discoverable by a human noticing. A **false split** regenerates something that already existed — wasted spend and a duplicate row, visible, harmless, fixable later. Setting a strict threshold biases every ambiguous call toward the second. The disambiguation stage gets built when real data shows bad merges actually occur, rather than as insurance against a failure that might never materialise. *And if it does occur?* The design for it already exists, and the corpus of observed bad merges is exactly the test set needed to calibrate it. See P4.

### ★★ The feed pages like a scroll feed, and the empty state is what made it interesting

A page is ~10 cards; the client requests the next page at ~3 remaining. Obvious, and right for the steady state. The design only got hard when it was checked against the state every user's *first* request lands in.

On a cold field there are no 10 cards, and there will not be for as long as the pipeline takes — a scrape plus several LLM calls per topic. Taken literally the contract requires the server to block until a page fills, which puts the worst latency in the product at the exact moment a content app gets abandoned. The fix is that a page may return fewer cards than asked for, including zero, alongside `generating: true`, and the client re-requests while that flag is set. One endpoint covers both cases and there is no second transport.

*Why not SSE, if the point is cards arriving as they're ready?* Because the granularity gained is one poll interval and the cost is a second transport — plus a concrete platform problem: **React Native has no native `EventSource`**, so mobile would need a polyfill while polling is an identical `fetch` on both clients. The original requirement was never "push"; it was "don't make the user wait for the whole batch", and polling satisfies it.

The transferable part is the question, not the answer: **a design validated against the steady state should be re-checked against the empty state**, because for anything that caches, empty is not an edge case — it is where every user starts. See P13.

### ★★ The view log was built before anything could read it

`User_View { user_id, scroll_id, viewed_at }` is written on every impression from the first working feed. In v1 nothing reads it. No dashboard, no resurfacing, no streaks.

Treating it as a feature — build it when something needs it — is the default, and it is wrong here, because this is the one dataset in the system that cannot be recreated. Schema can be migrated, embeddings can be regenerated from content, cards can be re-derived from sources. A user's viewing history from the months before you started logging is simply gone. Every retention feature on the roadmap (spaced resurfacing, coverage map, weekly recap, confidence scheduling) needs that history to start *before* the feature exists.

*Why not just add it when you build the first of those?* Because that feature would then launch with an empty table and be useless for its first several months, for exactly the users who were there earliest. The write costs a few lines and one append-only table; the alternative costs data that no amount of later engineering recovers. The general test — which data can be computed later, and which can only be captured live — is the one worth carrying to other projects. See P7.

### ★★ A no-retry rule and a cache combined into a bug neither one contains

Fact-check failures are discarded without retry. Topics are cached and reused across fields. Both decisions are individually sound, and together they produce something neither predicts: a topic whose drafts *all* fail gets **cached as failed**. The row exists, it is embedded, so every future field proposing that topic hits the cache, skips the pipeline, and serves nothing — indistinguishable from a healthy cache hit, forever.

The fix is a `status` field (`pending` / `ready` / `empty`) with one rule attached: **the lookup treats `empty` as a miss.** That is a column and a conditional. The interesting part is not the fix, it is that neither decision review would have caught it — the no-retry decision was evaluated per *card*, where dropping one is fine, and the caching decision was evaluated against *healthy* topics. The failure lives in the seam.

*How was it found, if there's no code?* By writing the data model's invariants out and hitting "a topic may have zero scrolls", then asking what the lookup does with one. **Every invariant is a question about what happens when it is satisfied at its boundary.** Alongside it: per-topic pass/fail counters, and a quarantine table keeping the rejected text — because an over-strict fact-checker and a weak card generator produce the *identical* rejection number, and only the text tells you which one you have. See P10.

### ★★ The index and the lookup were specified separately, so they disagreed

The Topic-Name Vector DB was specified to store `name + description` embeddings. The Candidate Topic Generator was specified to output names. Both reasonable in isolation; together they mean every lookup compares a short string against string-plus-paragraph vectors — an asymmetric comparison that depresses similarity scores, landing precisely on the strict threshold the entire reuse design depends on.

The fix is that the candidate generator emits a one-line description alongside each name, and **on a cache miss that same one-liner becomes the topic's stored description**. Both sides of every future comparison then come from the same model, the same prompt, the same length budget. Storing a description written later by a different prompt would have looked like the same fix and not been one — stylistic variance shows up in cosine distance as though it were semantic difference.

*What stops it decaying?* An explicit invariant: the embedded description is written once and never rewritten; a richer human-facing description would be a separate, unembedded column. Without that, someone improves a description in six months, every similarity score involving that topic shifts, and no test fails. **An index is a contract between a writer and a reader — specify both sides together, and decide what is available at query time before deciding what to store.** See P9.

### ★★ Postgres is the only source of truth; every vector is derived

Creating a topic writes to Postgres and Qdrant — two systems, no shared transaction. A failed vector write leaves a topic invisible to every lookup, so it regenerates forever with no error anywhere.

Handled with a transactional outbox: the topic row and an outbox row commit together in one Postgres transaction, and a worker drains the outbox into Qdrant with retry. The intent to write is committed atomically with the thing being written about, so the vector write can fail freely without losing the topic. Write order elsewhere is Postgres-first, on the same asymmetry that drives the matching threshold — Postgres-first fails toward waste (a topic that regenerates), vector-first fails toward corruption (an orphan vector that matches a lookup and then resolves to nothing).

*Why also build `reindex`, if the outbox is correct?* Because it was already required for an unrelated reason — the first embedding-model change invalidates every vector in both collections, and rebuilding from Postgres is the only way back. Building it early, while the corpus is small enough that running it is instant, means any future inconsistency is a known recovery rather than a debugging session. The underlying rule is the one worth keeping: **every invariant that spans two datastores is a background job you have not written yet.** See P11.

### ★ The scrape never reaches the user

Scraped text is input to the card generator and is never served. What ships is generated prose plus the `source_url` that grounded it.

The original concept was "scrape topics and show them", which stated plainly is redistributing other people's writing as the product. The fix was not a citation policy — it was removing the scrape from the output path entirely. Scraping became grounding, and the source link, originally conceived as a trust feature, turned out to double as attribution.

*Is that enough?* Not by itself, and the honest answer is the interesting part: the architecture removes the intent to republish but does not guarantee the outcome, because an LLM given a short snippet and asked for a short card can reproduce it closely. Prompt design, plus robots.txt and terms-of-service handling in the scraper, are still open. The structural question — does the scraped text ever reach the output at all — is answered; the behavioural one is not. See P1.

### ★★★ A scraper that scored 10/10 was getting four topics wrong

The viability spike reported *10 of 10 topics returned usable grounding* and printed `VERDICT: VIABLE`. The per-row output said something else: four Java topics had all matched the same article, byte-identical at 22,789 chars, and a fifth had matched a general data-structure page instead of the class.

The success test was `len(text) > 500`. **A wrong article is exactly as long as a right one**, so the metric could not express the failure it was meant to catch — 10/10 was guaranteed the moment anything came back.

What makes this more than a bad metric: nothing downstream would have caught it either. The fact-check gate asks whether a claim is *true*, and generic prose about collections is not false when the topic was `TreeSet` — merely not about it. A quality failure with **no detector anywhere in the design**.

The fix needed three parts, because none covered the others: a relevance check that refuses a wrong page, multi-candidate discovery (direct title lookup and search each find topics the other misses), and a second source for classes Wikipedia has no page for at any granularity — verified by querying: three of the five return 404 outright. The honest score dropped to 5/10 before climbing back to a real 10/10.

Then the relevance check committed the same category of error itself, accepting the `LinkedHashMap` section when asked for `HashMap`, because `{hash, map}` is a subset of `{linked, hash, map}`. Containment is right for article titles — `Anchoring` really is the topic of *Anchoring effect* — and wrong for sibling classes, where a longer name means a *different* thing. Every unit test had compared topics against titles; not one had compared a topic against a sibling.

**The transferable part:** before trusting a green result, ask whether the measurement is capable of being red. And when a rule gets reused somewhere new, check whether the *candidates* there have the same shape — the population changed from "pages that might be the topic" to "peers chosen for being similar", which inverts what a longer name means.

### ★ The zero-cost fallback runs the same manifests as production

Deployment targets GKE, chosen on a pricing comparison rather than preference: EKS charges a flat ~$0.10/hr control-plane fee (~$73/mo) with no free-tier equivalent, while GKE carries a standing $74.40/month credit covering one zonal cluster's management fee. For a project meant to run continuously on a personal budget that is roughly $73/mo versus roughly $0.

The part worth asking about is not the vendor choice, it is the fallback. A local `kind` cluster runs **the same manifests**, not a parallel docker-compose approximation. That keeps the escape hatch honest — if the credit changes or the cloud account goes away, the project still runs, and it runs the configuration that was actually tested rather than a simplified local variant that has been quietly drifting. Secondary benefit, stated plainly because it was part of the reasoning: existing cloud experience was AWS-heavy, so GCP added breadth rather than repeating what was already known.

---

## 6. Open items

Blocking work:

- [ ] **Confirm the frontend frameworks.** React Native (Expo) and Next.js were inferred from prior project history and never agreed. Blocks phase P5 / W6.
- [ ] Add a true polysemy pair to the labelled set before the threshold is trusted far. The designed collision ("Stack" the data structure vs the technology stack) never appeared, because the generator did not propose it for Web Development.

W0 remainder:

- [x] Qdrant collection definitions for both vector stores. Done — `topic_names` and `scroll_contents`, both 768 dims / Cosine, created by `npm run vectors:ensure`, which creates only what is missing and never alters an existing collection.

Known gaps to close during implementation:

- [x] Run the threshold calibration (phase P1b). Done — 44 labelled pairs, four model/prefix combinations swept, `e5-base-v2 @ 0.955` taken as the lowest value with zero false merges. The labelled set is committed alongside the number in `services/serving/calibration/`.
- [ ] Decide what the feed shows when a topic resolves to `empty` — skipping it silently is a choice, not a default.
- [x] Decide scraper robots.txt / terms-of-service handling. Done for both live sources. Wikipedia: `robots.txt` checked per host and cached before any fetch, with a real contact in the User-Agent (an unidentified client gets `403`); text is CC BY-SA and is never served, only used as grounding, with `source_url` carrying attribution (P1, invariant 4). Oracle: `robots.txt` permits the API docs and disallows `/search/`, which the deterministic class→URL lookup does not need. **A third source repeats this check** — it is per-host, not settled once.
- [ ] Re-check the GKE and EKS pricing figures before acting on the deployment decision — they were quoted during planning, not verified against a bill.
- [ ] Commit the advisory-lock test as a reproducible script. The 7.6s and concurrent-runner results in §4 came from an ad-hoc script that isn't in the repo yet.
- [ ] **Two live seed cards read `"Optional: seeded card 1. Placeholder text standing in for a generated card."` and one of them carries `trust_label = 'sourced_verified'`** (from `seed.ts`, 2026-09-12). Surfaced by the P33 re-check, which passed them — correctly: a placeholder asserts nothing false, so a *fact* checker has no grounds to reject it. That is the point worth keeping. The gate answers "is this true?", not "is this a card", and those are different questions; nothing currently asks the second. Related to the existing gap that `seed.ts` writes scrolls **bypassing the outbox**, so seeded rows differ from generated ones in more than one way.
- [ ] Put the project under git so CI can actually run, and so the stack can be tested from a literal fresh clone.
- [ ] Keep `ollama serve` running with **both** `qwen3:8b` (default) **and** `qwen2.5-coder:7b` (fallback) pulled — the stack's model calls depend on the host, not on a cloud key. Both were found missing on 2026-09-15 after a gap, and the failure is not obvious from the outside: a dead daemon returns `500` and a missing model returns `404`, both from `/v1/chat/completions`, while the gateway's own `/health/liveliness` stays `200` because it only reports that LiteLLM is up, not that any model behind it can answer. Check with `ollama list`, not with the gateway's health endpoint.
- [ ] **Replace dev auth before anything is exposed.** `AUTH_MODE=dev` (the default) trusts the bearer token as the user's identity. It exists so W2b could be built without Firebase credentials; anything reachable from a network while it is on is completely open (task 2b.1).
- [x] **Provide a contact URL for the scraper.** Done — `SCRAPER_CONTACT` is set in the gitignored `.env` to the project's GitHub repo, verified to return 200 so the contact is genuinely reachable. With it the spike went from **10/10 `HTTP 403`** to **10/10 success**, confirming the block was identification alone and nothing about the requests themselves.
- [x] **Decide how the scraper finds the *right* article.** Done — all three fixes shipped together, because none covered the others: a relevance check that refuses a wrong article (4a.1b), multi-candidate discovery pairing direct-title lookup with search (each finds a topic the other misses), and a Javadoc source for classes Wikipedia has no page for at all (4a.1c). Section extraction (4a.1d) covers the shared-article case. Result on the same 10 topics: **10/10 grounded on the right page**, *Java Collections* 1/5 → 5/5. See P26, P27, P28.
- [ ] Decide Ollama's `keep_alive`. The model is evicted from memory after about 5 minutes idle, and the next call then waits ~160s while it reloads, against ~3s warm. Keeping it resident costs roughly 5 GB of RAM permanently; accepting eviction makes the first request of a session very slow, which is exactly the cold-start path the feed design is most sensitive to.
- [x] Decide the outbox worker's retry/backoff policy and what happens to a row that never drains. Done — 5 attempts on exponential backoff from 2s (~62s total, comfortably longer than a Qdrant restart), then dead-letter. Reconciliation revives dead-lettered rows, so bounded retry is safe rather than lossy. Both are config (`OUTBOX_MAX_ATTEMPTS`, `OUTBOX_BASE_BACKOFF_SECONDS`).
- [ ] **`seed.ts` bypasses the outbox**, so seeded topics have no vector and are invisible to cache lookup until reconciliation or `reindex` runs. Harmless today — the feed tests do not use vectors — but it means a freshly seeded database violates invariant 5 until swept. Either give the seed outbox rows, or document that `reindex` is part of seeding.
- [x] Prometheus counters for drafts generated/passed/failed (task 4c.8). Done — `GET /metrics` on the pipeline. Serving still has no metrics endpoint; W7 adds it alongside the Grafana panels.
- [ ] **Rebuild images after changing service source.** Nothing in the local workflow does this, and the pipeline container sat unstartable for days while compose reported it healthy — it was serving an image built before the bug (P32). Either add a rebuild step to the routine or make CI build both images.
- [ ] Decide whether `Rejected_Draft` needs a retention policy, or grows unbounded.
- [ ] Set page size and prefetch threshold as config (10 / 3 are defaults, not measured). Poll cadence is server-dictated via `retry_after_ms` rather than a client constant — confirm that shape when writing the API contract.
- [ ] Make overlap-based and LLM-suggested adjacent fields visually distinct, since tapping the latter lands in a cold start.
- [ ] Decide whether the exclusion list passed to topic expansion needs a cap. Not needed at realistic field sizes; a safety valve if a field ever grows past a few hundred topics.
