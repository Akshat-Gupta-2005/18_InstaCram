# FEATURES — InstaCram

Living document. Updated at the end of every working session, as part of the work. Reasoning and history live in [DECISIONS.md](DECISIONS.md).

**Last updated:** 2026-09-15 — **The pipeline runs as a graph: one topic in, four fact-checked cards out, in 122s.** Sections 8a and 8b are complete (4a.1–4a.4, 4b.1, 4b.2). LangGraph was re-examined before being adopted — the agents were already orchestrated in ~30 lines of `asyncio`, and the dependency costs ~25 transitive packages — and kept deliberately, with the trade recorded. Wiring it immediately justified the scrutiny in an unexpected way: **P30**, where a conditional branch failed to skip the step it was meant to skip, because LangGraph fires a node when *any* inbound edge fires. An ungrounded topic generated cards from LLM material with **no source** and reported itself `ready` — invariant 4 broken by orchestration while every agent behaved correctly. Caught by a test written specifically because the join semantics were uncertain, asserting which steps did *not* run. Next: 8c — outbox, quarantine, counters, `reindex`. **Earlier the same day —** **W4's agents all work: one topic goes scrape → generate → write → fact-check and comes out as 4 verified cards.** Section 8a is complete (4a.1–4a.4). For `HashMap`: scraper and data-gen run concurrently in 37s, card generation returns 4 drafts with 0 malformed in 63s, and the fact-checker passes 4/4 at ~7.5s each — about **130s per topic** on a local `qwen3:8b`, the first real cost-per-topic number. A prompt bug surfaced on the first run (**P29**): the fact-checker's `verdict` key was documented only in a section the loader withholds from the model, so it invented `result` instead; a test now asserts every prompt names its own output keys. Next: 8b (graph wiring) and 8c (outbox, `reindex`, counters). **Earlier in the same day —** **W4's sourcing half: 10/10 topics grounded on the right page, the spike's headline number earned rather than assumed.** Tasks 4a.1, 4a.1b (relevance), 4a.1c (Javadoc source) and 4a.1d (section extraction) are complete. The route there is the useful part: the relevance check first dropped the score to a truthful **5/10** by refusing topics the spike had "grounded" on the wrong article; multi-candidate discovery recovered *Availability heuristic* (**6/10**); and the Javadoc source took *Java Collections* from 1/5 to 5/5 (**10/10**). Three bugs were caught along the way, each by running the thing rather than reading it: the check accepted sibling classes (**P27**), a soft 404 returned the JDK home page with HTTP 200 (**P28**), and `unsourced_topic` kept reporting five problems that a new source had already solved (migration `008`). **Earlier context:** Tasks 4a.1, 4a.1b (relevance check) and 4a.1d (section extraction) are done: on the spike's own 10 topics it grounds **5 and refuses 5**, and the 5 refusals are precisely those that would have been grounded on an article about something else. *LinkedHashMap* still grounds, on its own 424-char section of the shared page. The agent's first real run also exposed a bug in the new check itself — token containment accepted the *LinkedHashMap* section when asked for *HashMap*, and *CopyOnWriteArrayList* for *ArrayList* — fixed with a strict sibling rule and two regression tests per trap, one of which asserts the old rule **would** have accepted it so the fix cannot be quietly removed (**P27**). **The scraper spike is answered, and it turned a suspected W4 risk into a measured one.** Retrieval is fine: 10/10 topics returned usable grounding over plain HTTP in ~1.1s each, so **no browser is needed** and Playwright is not required for this source. Relevance is not: four Java topics were grounded on one *identical* article, because Wikipedia has **no page at all** for `HashMap`, `LinkedHashMap` or `ConcurrentSkipListMap` and redirects `TreeSet`/`ArrayList` to general CS concepts — so no query tuning can fix it. Recorded as **P26**, with three fixes scheduled into W4 (relevance check, second source, section extraction) and an `unsourced_topic` table (migration `007`) that records recurrences, exported to a readable JSON snapshot. Configuration became real in the same pass: one gitignored root `.env`, loaded by explicit path in both services and forwarded into containers, after five entrypoints were found resolving it against the wrong directory (**P25**). **W3 still holds: the two numbers the cache-then-generate design rests on are measured, not assumed.** The candidate generator turns a field name into described topics (156 candidates over 8 fields, 8/8 once JSON mode fixed the malformed-reply losses, P24), and a sweep over **44 hand-labelled pairs** picked **`intfloat/e5-base-v2` at threshold `0.955`** — the lowest cutoff with **zero false merges**, retaining **67% reuse**, beating MiniLM (53%), e5 with its `query:` prefix (53%) and bge (40%). **The §6.2 go/no-go passed**, so the P4 deferral stands: strict-threshold-only matching works, at a measured price of roughly a third of identical topics regenerating as duplicates. Both Qdrant collections now exist (768 dims, Cosine), closing the last W0 item, and the `embeddings` service serves e5 — verified **byte-identical** (max abs diff `0`) to the container the calibration actually ran on, so the threshold still means what the sweep said. W1/W2/W2b still hold: **23/23 tests** green, 11 tables in 6 migrations, 22/22 invariant checks, six services from one command, LLM local via Ollama (`qwen3:8b`, thinking off). Not built: the generation pipeline (W4), the cache-then-generate wiring (W5), any client (W6). **Auth is a dev stub** that trusts the bearer token as the identity. The scraper spike is blocked on a contact URL. Next: W4.

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
│   └── fact-check.md                  pass/fail + failed_claim + reason, written for the quarantine's human reader
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
│   │   ├── app/agents/fact_check.py   the sole quality gate; an unusable verdict raises, never defaults to fail (4a.4)
│   │   ├── app/graph/pipeline.py      LangGraph: 5 steps, 1 branch, 4 distinguishable outcomes; the no-op join is load-bearing (P30)
│   │   ├── app/repo/unsourced.py      upserts unsourced_topic; dedupes, counts, never appends per run
│   │   ├── spikes/scraper_spike.py    throwaway: can we retrieve usable grounding, and by what route (P26)
│   │   ├── scripts/run_scraper.py     runs the scraping agent standalone over the spike's 10 topics
│   │   ├── scripts/run_agents.py      all four agents called directly — a failure points at one agent (8a)
│   │   ├── scripts/run_pipeline.py    one topic through the compiled graph — exercises orchestration (4b.1)
│   │   ├── scripts/export_unsourced.py  regenerates the JSON below from the unsourced_topic table
│   │   ├── sourcing/unsourced-topics.json  GENERATED — topics whose scrape returned the wrong article
│   │   └── tests/                     test_health.py · test_relevance.py (the sibling traps) · test_javadoc.py (the soft-404 regression) · test_llm.py · test_card_gen.py · test_prompts.py (each prompt names its own output keys) · test_graph.py (asserts which steps did NOT run)
│   └── llm-gateway/config.yaml        LiteLLM: host Ollama, qwen3:8b with think:false (P23)
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

Both services boot and answer `/health`, and nothing more: **no feature logic exists yet.** Specifically missing:

- **No API routes** beyond `/health`. The feed, views, saves, expansion and revision endpoints are specified in [API-CONTRACT.md](API-CONTRACT.md) and unbuilt (W2, W2b).
- **No pipeline.** No LangGraph graph, no agents, no outbox worker, no `reindex` (W4). The prompts exist; nothing calls them.
- **No vector collections.** Embeddings work (768 dimensions with the default model), but no Qdrant collections exist yet, because the vector dimension waits on the W3 model comparison.
- **No LLM calls.** The gateway runs; `GEMINI_API_KEY` is unset and nothing sends it a request.
- **No clients.** Framework not confirmed (§7).
- **No K8s manifests, no Grafana dashboards** (W7).
- **Real tests: only the schema checks.** `verify-invariants.sql` is real. The two unit tests are placeholders that exist so CI has something to run.

The rest of the proposed layout is in [BUILD-PLAN.md](BUILD-PLAN.md) §6.

### Central pipeline — the request path, traced end to end

This is the path a single field-of-interest request takes. **Every file path below is planned, not existing.**

| Step | File (planned) | What happens |
|---|---|---|
| 1 | `services/serving/src/routes/feed.ts` | Client POSTs a field name. Gateway routes to the serving service. |
| 2 | `services/serving/src/feed/orchestrator.ts` | Feed Orchestrator takes over; opens a stream back to the client before any content exists. |
| 3 | `services/serving/src/topics/candidates.ts` | Candidate Topic Generator (LLM) turns the field name into candidate topic names **plus a one-line description each**. The description is both the query text and, on a miss, the stored one. |
| 4 | `services/serving/src/topics/lookup.ts` | `embed(name + description)` is searched against the Topic-Name Vector DB at a calibrated strict threshold. A topic with `status = 'empty'` counts as a **miss**. **The branch point.** |
| 5a | `services/serving/src/topics/reuse.ts` | **MATCH** → write one `Field_Topic` row, fetch the topic's existing scrolls, stream them. Pipeline never runs. |
| 5b | `services/pipeline/app/graph/generate.py` | **NO MATCH** → trigger the generation graph for that one topic, asynchronously. |
| 6 | `services/pipeline/app/agents/scraper.py` | Web Scraping Agent (non-LLM) pulls raw snippets + source URLs. Runs concurrently with step 7. |
| 7 | `services/pipeline/app/agents/datagen.py` | LLM Data-Generation Agent produces supplementary explanation. Runs concurrently with step 6. |
| 8 | `services/pipeline/app/agents/cardgen.py` | Card Generation LLM combines both into multiple one-page draft cards. Generated prose, never the scrape verbatim. |
| 9 | `services/pipeline/app/agents/factcheck.py` | Fact-Check Agent verifies each draft against the gathered sources. |
| 10a | `services/pipeline/app/stores/quarantine.py` | **FAIL** → draft goes to `Rejected_Draft` with its reason, counters increment. No retry. If no draft survives, `Topic.status = 'empty'`. |
| 10b | `services/pipeline/app/stores/persist.py` | **PASS** → write scroll to Postgres, embed into Scroll-Content VDB, link `Field_Topic`, set `Topic.status = 'ready'`, stream the card to the waiting client immediately. |
| 10c | `services/pipeline/app/outbox/worker.py` | The topic's Topic-Name vector is written by the outbox worker, not inline — the outbox row was committed in the same transaction as the topic. |
| 11 | `services/serving/src/account/views.ts` | As each card is displayed, one `User_View` row is written. Nothing reads it yet — deliberately (P7). |

---

## 3. Features

Grouped in dependency order: data layer first, then the paths that depend on it.

### 3.1 Data layer — foundations

| Feature | Status | What it does | Lives in | Star |
|---|---|---|---|---|
| Postgres schema | `Done` | 11 tables and the `live_scroll` view, applied by 6 migrations. **All 22 invariant checks pass** against Postgres 16: field-name dedup, polysemous topics coexisting, junction uniqueness, provenance/trust-label/status constraints, description immutability, append-only `user_view`, the quarantine cap, saves (foreign key and idempotency), retire-not-delete (a delete is rejected; a retired card leaves `live_scroll` and keeps its views and saves), and account erasure (checks 10a–10d). Invariant 8 became enforceable in `004`, invariant 12 was added in `005`, and invariant 13 in `006`. Invariants 5, 6 and 11 still aren't enforceable in the database; they're listed at the bottom of `001_init.sql`. | `services/serving/src/db/migrations/` | |
| Migration runner | `Done` | Forward-only. Each file and its bookkeeping row commit as one transaction (P15), and runs are serialised by an advisory lock. Verified: a second run reports "no pending migrations"; with the lock held elsewhere the runner waited and finished in 7.6s vs ~1.4s unblocked; of two runners started together, one applied and one found nothing pending. It runs automatically before the server on every serving start, and every failure is logged with a `MIGRATION FAILED` prefix (P22). | `services/serving/src/db/migrate.ts` | |
| `Field_Topic` junction table | `Planned` | Many-to-many link making a topic independent of any field. One row is the entire cost of surfacing an existing topic under a new field. | `services/serving/src/db/` | ★★★ |
| Topic-Name Vector DB | `Planned` | Qdrant collection, `{ topic_id, embed(name + description) }`. The description is the candidate generator's one-liner, so query and index vectors come from the same producer — symmetric by construction. Resolves P9. | `services/pipeline/app/stores/` | ★★ |
| Scroll-Content Vector DB | `Planned` | Qdrant collection, `{ scroll_id, topic_id, content embedding }`. Written per card; **nothing reads it in v1** — it exists so that "more like this" and semantic search are possible later without regenerating embeddings for the whole corpus. | `services/pipeline/app/stores/` | |
| Transactional outbox + worker | `Planned` | `Topic` row and `Outbox` row commit in one Postgres transaction; a worker drains the outbox into Qdrant with retry. A vector write can fail without the topic ever being lost. Resolves P11. | `services/pipeline/app/outbox/` | ★★ |
| Two-way reconciliation check | `Planned` | Safety net behind the outbox: topics with no vector (re-embed), vectors with no topic (delete). Startup + scheduled. | `services/pipeline/app/outbox/` | |
| `reindex` command | `Planned` | Rebuilds both Qdrant collections from Postgres. Built early and independently of P11 — the first embedding-model change invalidates every vector, and this is the only way back. | `services/pipeline/app/reindex/` | |

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
| LangGraph pipeline definition | `Planned` | 5 steps, 4 LLM agents + 1 non-LLM scraper, with one real branch at fact-check. | `services/pipeline/app/graph/` | |
| Web Scraping Agent | `Planned` | Playwright-driven. Out: snippets + source URLs, used as grounding only. Same library as the E2E test suite. | `services/pipeline/app/agents/` | |
| LLM Data-Generation Agent | `Planned` | Fills gaps the scrape misses. No data dependency on the scraper — the two run concurrently, which is the main parallelism in the pipeline. | `services/pipeline/app/agents/` | |
| Card Generation LLM | `Planned` | Writes multiple one-page drafts per topic from both inputs. Generated prose plus a source link, never republished scrape. | `services/pipeline/app/agents/` | ★ |
| Fact-Check Agent | `Planned` | Sole quality gate. Fail → quarantined, no retry. Pass → persisted and streamed. | `services/pipeline/app/agents/` | |
| Fact-check counters | `Planned` | `Topic_Generation_Stats` — drafts generated / passed / failed per topic, plus a Prometheus counter. Makes the rejection rate a number someone can look up. | `services/pipeline/app/stores/` | |
| `Topic.status` (`pending`/`ready`/`empty`) | `Planned` | Makes the zero-card topic representable **and** makes the lookup treat it as a miss. Without it a topic whose drafts all failed is cached and re-served as a successful hit forever. Resolves the sharper half of P10. | `services/serving/src/db/` | ★★ |
| `Rejected_Draft` quarantine | `Planned` | Keeps the last 5 rejected drafts per topic with reasons. An over-strict checker and a bad generator produce the identical rejection number; only the text separates them. It is also the evidence the deferred no-retry decision is waiting on. Separate table, never a flag on `Scroll` (invariant 10). | `services/pipeline/app/stores/` | |
| LiteLLM gateway | `Done` | One OpenAI-compatible endpoint for both services, so the model is a config value. **Points at Ollama on the host** (`qwen3:8b` with `think: false`, fallback `qwen2.5-coder:7b`) — no API key, no per-call cost. Verified: a real completion returns clean text, a strict-JSON prompt parses first try, and both `serving` and `pipeline` reach it over the private network. No agent code calls it yet; that's W3. | `services/llm-gateway/config.yaml` | |

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
| Prometheus + Grafana | `Planned` | Per-service metrics. The two services fail differently, so serving latency and pipeline throughput need separate views. | `infra/grafana/` | |
| Test suites | `Planned` | Unit + integration per service; E2E covering field request → feed render → bookmark → reload. | `tests/` | |

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
| Pipeline | `ruff` clean; **80 passed, 1 xfailed** (the xfail is `strict` — it asserts the abbreviation limitation still exists) | `cd services/pipeline && ruff check . && pytest` |
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
| Pipeline latency, single topic | Wall clock, scrape start → first card streamed | not measured |
| Time to first card on a cache hit | Wall clock, request → first card rendered | not measured |
| Fact-check rejection rate | Fail count ÷ draft count, per topic (see P10) | not measured |
| Topics with zero surviving cards | Count of topics where every draft failed | not measured |
| Test count and pass rate | CI output | not measured |

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
- [ ] Put the project under git so CI can actually run, and so the stack can be tested from a literal fresh clone.
- [ ] Keep `ollama serve` running with **both** `qwen3:8b` (default) **and** `qwen2.5-coder:7b` (fallback) pulled — the stack's model calls depend on the host, not on a cloud key. Both were found missing on 2026-09-15 after a gap, and the failure is not obvious from the outside: a dead daemon returns `500` and a missing model returns `404`, both from `/v1/chat/completions`, while the gateway's own `/health/liveliness` stays `200` because it only reports that LiteLLM is up, not that any model behind it can answer. Check with `ollama list`, not with the gateway's health endpoint.
- [ ] **Replace dev auth before anything is exposed.** `AUTH_MODE=dev` (the default) trusts the bearer token as the user's identity. It exists so W2b could be built without Firebase credentials; anything reachable from a network while it is on is completely open (task 2b.1).
- [x] **Provide a contact URL for the scraper.** Done — `SCRAPER_CONTACT` is set in the gitignored `.env` to the project's GitHub repo, verified to return 200 so the contact is genuinely reachable. With it the spike went from **10/10 `HTTP 403`** to **10/10 success**, confirming the block was identification alone and nothing about the requests themselves.
- [x] **Decide how the scraper finds the *right* article.** Done — all three fixes shipped together, because none covered the others: a relevance check that refuses a wrong article (4a.1b), multi-candidate discovery pairing direct-title lookup with search (each finds a topic the other misses), and a Javadoc source for classes Wikipedia has no page for at all (4a.1c). Section extraction (4a.1d) covers the shared-article case. Result on the same 10 topics: **10/10 grounded on the right page**, *Java Collections* 1/5 → 5/5. See P26, P27, P28.
- [ ] Decide Ollama's `keep_alive`. The model is evicted from memory after about 5 minutes idle, and the next call then waits ~160s while it reloads, against ~3s warm. Keeping it resident costs roughly 5 GB of RAM permanently; accepting eviction makes the first request of a session very slow, which is exactly the cold-start path the feed design is most sensitive to.
- [ ] Decide the outbox worker's retry/backoff policy and what happens to a row that never drains.
- [ ] Decide whether `Rejected_Draft` needs a retention policy, or grows unbounded.
- [ ] Set page size and prefetch threshold as config (10 / 3 are defaults, not measured). Poll cadence is server-dictated via `retry_after_ms` rather than a client constant — confirm that shape when writing the API contract.
- [ ] Make overlap-based and LLM-suggested adjacent fields visually distinct, since tapping the latter lands in a cold start.
- [ ] Decide whether the exclusion list passed to topic expansion needs a cap. Not needed at realistic field sizes; a safety valve if a field ever grows past a few hundred topics.
