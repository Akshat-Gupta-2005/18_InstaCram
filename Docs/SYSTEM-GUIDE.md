# SYSTEM GUIDE — the running system, explained

A learning document. It answers: what is running, what each container does, how they find each other, how the database is built and kept honest, and what it looks like when each piece breaks.

The other documents answer different questions. [FEATURES](FEATURES.md) is what is true today, [DECISIONS](DECISIONS.md) is why it is this way (and every mistake made getting there), [BUILD-PLAN](BUILD-PLAN.md) is the intent, [API-CONTRACT](API-CONTRACT.md) is what clients may rely on. This one is the tour of the machine.

---

## 1. The shape of it

InstaCram takes a **field** you name and gives you a feed of one-page **cards**. The product bet is that **a topic is not owned by the field that created it**: a `HashMap` card generated for "Java Data Structures" serves "Java Collections" for free. Everything in the system exists to make that reuse safe — to decide whether a topic already exists, to generate it when it doesn't, and never to show a card that failed its fact check.

That produces two halves with incompatible speeds:

| | **Serving** | **Pipeline** |
|---|---|---|
| Language | Node 22 + Express + TypeScript | Python 3.12 + FastAPI + LangGraph |
| Answers in | milliseconds | minutes |
| Job | feed, auth, saves, views, "do we already have this topic?" | scrape, generate, fact-check, persist |
| Failure profile | must stay up; a user is waiting | may fail one topic without taking the feed down |

**They never call each other.** There is no HTTP between them, no queue broker, no gRPC. The handoff is a row in Postgres: serving inserts a topic with `status = 'pending'`, and that row *is* the pipeline's job. This is the single most important structural fact in the system — it means either half can be restarted, redeployed or broken without the other losing work.

---

## 2. The containers

Eight things run. Six are containers from `docker-compose.yml`; two are not, and that trips people up.

```
                    ┌──────────────────────────────────────────────────┐
   you ── :8082 ──▶ │  Expo dev server (NOT a container, host)         │
                    └───────────────────────┬──────────────────────────┘
                                            │ browser calls :3000
                    ┌───────────────────────▼──────────────────────────┐
                    │  serving   :3000    Node 22                      │
                    │  feed · auth · views · saves · topic resolution  │
                    │  · the field-expansion worker                    │
                    └───┬──────────────┬─────────────┬─────────────────┘
                        │              │             │
          ┌─────────────▼───┐  ┌───────▼──────┐  ┌───▼────────────┐
          │ postgres :5432  │  │ qdrant :6333 │  │ embeddings     │
          │ SOURCE OF TRUTH │  │ derived      │  │ :8081 → :80    │
          └─────────────▲───┘  └───────▲──────┘  └───▲────────────┘
                        │              │             │
                    ┌───┴──────────────┴─────────────┴─────────────────┐
                    │  pipeline  :8000    Python 3.12                  │
                    │  scraper · data-gen · card-gen · fact-check      │
                    │  · topic worker · outbox worker                  │
                    └───────────────────────┬──────────────────────────┘
                                            │
                    ┌───────────────────────▼──────────────────────────┐
                    │  llm-gateway :4000   LiteLLM                     │
                    └───────────────────────┬──────────────────────────┘
                                            │ host.docker.internal:11434
                    ┌───────────────────────▼──────────────────────────┐
                    │  Ollama (NOT a container, your machine)          │
                    │  qwen3:8b, thinking off                          │
                    └──────────────────────────────────────────────────┘
```

### postgres — `postgres:16-alpine`, port 5432

The source of truth for everything: fields, topics, cards, views, saves, quarantined drafts, and every queue. Data lives in the named volume `pgdata`, so it survives `docker compose down` and dies on `docker compose down -v`.

It is the only container with a **healthcheck that others wait for** (`pg_isready`). Both backend services declare `depends_on: postgres: condition: service_healthy`, so they never start against a database that is still booting.

**If it's down:** serving returns 503 from `/health`, the pipeline's `/health` says `"db": "unreachable"`, and both workers keep retrying — since 2026-09-16 they reconnect rather than looping forever on one dead connection (P37).

### qdrant — `qdrant/qdrant:v1.12.1`, port 6333

Vector search. Two collections, both **768 dimensions, cosine**: `topic_names` (is this candidate the same as a topic we already have?) and `scroll_contents`.

Everything here is **derived**. If Qdrant were deleted, `reindex` rebuilds it from Postgres. The reverse is not true, and that asymmetry is deliberate: a vector store that is authoritative for nothing can be wiped without a backup plan.

Two consequences worth remembering:
- **A collection's vector size cannot be changed after creation.** Changing the embedding model is a rebuild, not a tweak — and it invalidates the calibrated threshold at the same time, so you re-index and re-calibrate together or neither.
- **The collections are not created automatically.** `npm run vectors:ensure` creates them; nothing does it at boot.

### embeddings — `ghcr.io/huggingface/text-embeddings-inference:cpu-1.9.3`, host port 8081 → container port 80

Self-hosted `intfloat/e5-base-v2`. Turns a topic's name-plus-description into a 768-dim vector. This is the **highest-volume model call in the system**, which is why it is self-hosted and does *not* go through the LLM gateway.

Two things pinned on purpose:
- **The image tag is exact, never `latest`.** The similarity threshold `0.955` was calibrated against vectors from one exact runtime. An image that silently drifted on a future pull would invalidate the threshold with no error anywhere. (Also, `cpu-1.5` could not download models at all — P19.)
- **The model is a variable** (`EMBEDDING_MODEL`), because W3 swept candidates before committing to one.

**First start downloads the model** into the `embeddingcache` volume — measured at 289–329 seconds. Later starts reuse it. A cold first run that looks hung is usually this.

### llm-gateway — `ghcr.io/berriai/litellm:main-latest`, port 4000

One OpenAI-compatible endpoint so **the model is a config value, not a code dependency**. `services/llm-gateway/config.yaml` is the switch: three entries (`default` = qwen3:8b with thinking off, `fallback` = qwen2.5-coder:7b, `thinking` = the same model with reasoning on, used only for a measurement), plus a commented Gemini entry showing that moving to a hosted provider is an edit to that one file.

**Its health endpoint lies.** `/health/liveliness` returns 200 while a dead Ollama returns 500 and a missing model returns 404 on the actual completion path. To know the model is really there, run `ollama list` on the host.

### serving — built from `services/serving/Dockerfile`, port 3000

The read path plus the expansion worker. Multi-stage build on `node:22-alpine`: compile TypeScript, then a production image with dev dependencies omitted.

Two details in that Dockerfile are load-bearing:
- **The build context is the repo root**, not `services/serving`, because the image must include `prompts/`. Prompts are *behaviour* — agents read them at runtime — so they ship with the image, versioned with the code that runs them.
- **`CMD` is `node dist/db/migrate.js && exec node dist/index.js`.** Migrations run before the server every start, and `&&` means the server never starts against a schema that is behind. `exec` hands PID 1 to node so it receives SIGTERM directly.

### pipeline — built from `services/pipeline/Dockerfile`, port 8000

`python:3.12-slim`, `pip install .`, then `uvicorn app.main:app`. It serves `/health` and `/metrics`, and — since 2026-09-16 — **starts the two workers in its FastAPI lifespan**:

- **topic worker:** claims `pending` topics and runs them through the graph.
- **outbox worker:** drains owed vectors into Qdrant.

Before that date it started neither. The outbox worker had been proven by scripts calling it by hand, and the deployed service never ran it, so vectors sat owed for hours while every check passed (P37). That is why `/health` now reports each worker by name rather than assuming.

The topic worker **refuses to start without `SCRAPER_CONTACT`**, and says so in `/health`, rather than pretending to generate. The scraper identifies itself honestly in its User-Agent; Wikimedia answers 403 without it.

### Ollama — on your machine, port 11434

Not a container. The model weights and the GPU live on the host. Inside a container `localhost` means the container itself, so the gateway reaches the host at `host.docker.internal`, supplied as `OLLAMA_BASE_URL`. `extra_hosts: host.docker.internal:host-gateway` makes that name work on Linux, where it isn't built in.

**Needs to be running:** `ollama serve`, plus `ollama pull qwen3:8b`. If it is down, every generation stalls and nothing else looks wrong.

### Expo dev server — on your machine, port 8082

Also not a container. `cd clients/app && npm run web`. Port **8082, not Expo's usual 8081**, because the embeddings service holds 8081.

The browser calls the API directly at `http://localhost:3000`, so two things must line up: `CORS_ORIGINS` in `.env` must list `http://localhost:8082`, and on a phone or Android emulator `EXPO_PUBLIC_API_URL` must point at your machine's real address (`10.0.2.2` for the emulator, your LAN IP for a device).

---

## 3. How they find each other

### One network, names as addresses

Compose creates a network for the project (named `instacram`, so `instacram_default`). Every service joins it, and **the service name is its hostname**. Inside the network, serving reaches the database at `postgres:5432` — never `localhost`, which would mean the serving container itself.

That's why the same variable has two different values depending on where the code runs:

| Running where | `DATABASE_URL` |
|---|---|
| Inside a container | `postgres://instacram:instacram@postgres:5432/instacram` (set in `docker-compose.yml`) |
| On your machine (tests, migrate, seed, calibration) | `postgres://instacram:instacram@localhost:5432/instacram` (from `.env`) |

Both work because the compose file **publishes** ports to the host (`"5432:5432"`). Publishing is only for you and your tools; containers talking to each other never need it. The one asymmetric case is embeddings, published as `8081:80` — port 80 inside, 8081 outside.

### `depends_on` starts things; it does not make them ready

`depends_on` with `condition: service_healthy` waits for Postgres's healthcheck. Nothing waits for Qdrant, embeddings or the gateway — they are used lazily, and a call that arrives too early fails and is retried rather than blocking startup.

### `.env`: one file, three consumers, and the trap

There is exactly one `.env`, at the repo root, gitignored. It is read by:

1. **docker compose**, automatically, to substitute `${VAR}` **in the compose file**;
2. **serving**, via `src/env.ts`, which resolves the root path explicitly;
3. **pipeline**, via `load_dotenv()` pointed at the root path.

Node and Python both run with their service folder as the working directory, so neither finds a root `.env` on its own. Five entrypoints were once resolving it against the wrong directory (P25). Hence the explicit paths, and no second `.env` anywhere — two copies drift.

**The trap worth internalising:** compose substitution and container environment are *not* the same thing. Using `${TOPIC_MATCH_THRESHOLD}` inside `docker-compose.yml` puts nothing inside the container. A variable must be listed under that service's `environment:` before the process can read it. Otherwise tuning `.env` changes host runs and leaves containers on the code default — with no error to notice.

---

## 4. How the database is handled

### Postgres is the only thing that must be backed up

15 tables, 12 forward-only migrations. Everything else in the system — vectors, indexes, caches — is derived and rebuildable.

The tables that carry the design:

| Table | Why it exists |
|---|---|
| `field`, `topic`, `field_topic` | `field_topic` is the junction that makes reuse real: one topic row, many fields. Reuse is one insert. |
| `topic.status` (`pending` / `ready` / `empty`) | Makes a zero-card topic representable **and** makes the cache treat it as a miss. Without it, a topic whose drafts all failed caches as a success forever. |
| `scroll` + the `live_scroll` view | Cards are **retired, never deleted**, and every read goes through the view — so the safe query is the default one. |
| `user_view` | Append-only by trigger. It is the paging position *and* the only dataset that cannot be rebuilt. |
| `saved_scroll` | Saves as rows with real foreign keys, not an array (P18). |
| `rejected_draft` | Quarantine, capped at 20 per topic by trigger, with the checker's reason. An over-strict checker and a bad generator produce the same count; only the text separates them. |
| `outbox` | Owed vectors. Written in the same transaction as the topic. |
| `field_expansion` | Candidate generation as a job row. |
| `topic_generation_stats` | Counters, written in the same transaction as the cards. |
| `unsourced_topic` | Topics no source could ground — rows are **resolved, not deleted**, when a later source succeeds. |
| `erasure_log` | Account erasure audit: counts, no identifier. |

**Rules live in the database, not in convention.** Triggers block updating or deleting a `user_view`, block deleting a scroll anyone has seen, and exempt only `erase_account()`. `src/db/verify-invariants.sql` tries to break each one and reports 22 PASS/FAIL checks inside a transaction it rolls back.

### Migrations

A deliberately small runner (`src/db/migrate.ts`), not a migration library:

- Applies every `.sql` in filename order, once each, tracked in `schema_migrations`.
- **Each file runs in one transaction together with its `schema_migrations` row.** Therefore migration files must never contain `BEGIN`/`COMMIT` — a commit inside the file would close that transaction early and let schema be applied without being recorded (P15).
- **Runs are serialised by a Postgres advisory lock.** Two runners starting at once (two Kubernetes replicas, say) cannot both apply the same file.
- Running it twice is a no-op. CI proves exactly that by running it twice against an empty database.
- Failures log `MIGRATION FAILED:` with the filename, so a container that refuses to start names its cause on the first line.

In the container this runs on every start. On your machine: `npm run migrate`.

**Always `docker compose up -d --build` after pulling changes.** Migrations ship *inside* the serving image; an older image applies an older schema and reports success.

### Test databases

Neither test suite mocks the database, because the rules under test — `SKIP LOCKED`, view exclusion, triggers, the stale-claim window — are properties of Postgres. A mock would test the mock.

| Suite | Database | Built how |
|---|---|---|
| serving (vitest) | `instacram_test` | dropped and recreated per run, then **the same `applyMigrations` the container uses** |
| pipeline (pytest) | `instacram_pipeline_test` | rebuilt once per session from **serving's migration files** |

Both build from the real migrations rather than a hand-written copy, because a copy drifts silently — and silent drift is exactly the class of bug this project keeps finding.

### Seed data

`npm run seed` writes fixtures including the awkward cases: a shared topic, a pending one, an empty one, a retired card. They are hand-written, which matters for one non-obvious reason: **hand-written topics break the cache's same-producer symmetry** (P36). The embedding cache compares generator-written descriptions with each other; a seed row described by a human is largely invisible to it. So no cache hit rate may be measured on the development database.

### Qdrant's data

Created by `npm run vectors:ensure`, filled by the outbox worker, checked by `npm run vectors:verify`, rebuilt by `reindex`. Reconciliation is deliberately **asymmetric**: a missing vector is re-enqueued (wasteful but safe), an orphan vector is deleted (a stale hit would be corruption).

### What is *not* handled

No backups, no restore procedure, no point-in-time recovery, no read replica, no connection pooler beyond `pg`'s own pool. One Postgres on one machine, in a Docker volume. That is fine for a laptop and is the first thing to change if this is ever deployed.

---

## 5. A request, traced through the containers

**You open the field "Java Collections".**

1. **Expo (8082)** posts `/v1/feed` to **serving (3000)** with your bearer token.
2. **serving** finds or creates the field row in **postgres**, and *enqueues* an expansion — it does not run it. Candidate generation takes 32–54s; the request returns in about 224ms.
3. **serving** reads the cards you have not viewed. New field, nothing yet: the page comes back with `generating: true` and a `retry_after_ms`, and the app polls at that cadence.
4. Meanwhile **serving's expansion worker** claims the job, asks **llm-gateway → Ollama** for candidate topics with one-line descriptions.
5. For each candidate, **serving** embeds the text via **embeddings**, searches **qdrant** at threshold `0.955`, *and* reads **postgres** for same-name topics whose vector is still owed — all under an advisory lock on the candidate name, so simultaneous requests cannot both create it.
   - **Hit** → one `field_topic` row. The existing cards serve under the new field immediately, at zero LLM cost. This is the product's whole thesis.
   - **Miss** → a `topic` row as `pending`, plus its `outbox` row, in one transaction.
6. **pipeline's topic worker** claims a pending topic (`FOR UPDATE SKIP LOCKED`) and runs the graph: **scraper** (plain HTTP, no browser) and **data-gen** (LLM) concurrently, then **card-gen** (LLM) writes 2–4 drafts, then **fact-check** (LLM) judges each against the gathered material. Survivors are written to **postgres** with their counters in the same transaction; failures go to `rejected_draft` with a reason.
7. **pipeline's outbox worker** drains the owed vector into **qdrant**, so the topic can be found by meaning next time.
8. Your next poll returns the new cards. As each is displayed for 600ms, the app records a view and sends it — which is also how the next page is decided.

---

## 6. Everyday commands

```bash
# Start everything (always --build after pulling code: migrations ship in the image)
docker compose up -d --build

# Is it healthy?
curl localhost:3000/health          # serving: db only
curl localhost:8000/health          # pipeline: db + EACH WORKER by name; 503 if one died
curl localhost:8000/metrics         # Prometheus text: drafts, outcomes, outbox, durations

# Logs
docker compose logs -f serving
docker compose logs --since 30m pipeline

# Talk to the database
docker compose exec postgres psql -U instacram -d instacram
docker compose exec -T postgres psql -U instacram -d instacram -c "select status, count(*) from topic group by 1;"

# Rebuild one service after changing its code
docker compose up -d --build serving

# Stop. KEEPS data.
docker compose down

# Stop and DESTROY the volumes: database, vectors, the cached embedding model.
docker compose down -v          # you will re-download the model and lose every card

# On the host
npm --prefix services/serving run migrate         # apply migrations
npm --prefix services/serving run seed            # fixtures
npm --prefix services/serving run vectors:ensure  # create the two Qdrant collections
npm --prefix services/serving run vectors:verify  # index and lookup agree, real stack
cd clients/app && npm run web                     # the app at :8082
```

---

## 7. When it breaks, this is what it looks like

| Symptom | Usually |
|---|---|
| Everything answers, nothing ever generates | Ollama is not running on the host, or the model isn't pulled. `ollama list`. The gateway's health endpoint will still say 200. |
| First `up` seems to hang for minutes | The embeddings container is downloading the model into its volume (289–329s once, then cached). |
| `serving` exits on start | Migration failure. First line of `docker compose logs serving` says `MIGRATION FAILED:` and names the file. |
| Code changes have no effect | The container is running the **old image**. `docker compose up -d --build <service>`. A container ran unstartable code for days once because nothing rebuilt it (P32). |
| Topics generate but never become searchable | The outbox worker. Check `/health` on the pipeline — it reports each worker by name (P37). |
| `/health` on pipeline returns 503 with `topics: disabled` | `SCRAPER_CONTACT` is not set. The scraper must identify itself or Wikimedia answers 403. |
| Expo refuses to start on 8082 | A dev server is already there — or you're colliding with the embeddings service on 8081. |
| The app loads but every call fails | `CORS_ORIGINS` doesn't list the app's origin, or the token expired (the app signs you out on 401). |
| A setting in `.env` changes nothing in a container | It isn't listed under that service's `environment:` in the compose file. Substitution ≠ environment. |

---

## 8. Two habits this codebase runs on

**Postgres is the source of truth; everything else is derived.** Vectors, indexes and caches can be rebuilt. This is why there is no message broker: queues are tables, claimed with `FOR UPDATE SKIP LOCKED`, and a stale claim window doubles as retry backoff. One less system to run, one less system to lose data in.

**Every quality gate needs a negative control.** The fact-checker once looked perfect while blind — Ollama was silently truncating over-long prompts from the front, where the card sits, so it was approving cards it had never been shown (P33). A race test passed with the lock deleted (P35). CI was green on a laptop that had a database CI didn't (P34). The rule that came out of it: **see the test fail with the mechanism removed, or you have not tested it.** `scripts/negative_control.py` exists solely to prove the gate can still say no, and must be run after any change to a prompt, a model or a context budget.

---

## 9. Glossary

| Term | In this system |
|---|---|
| **Transactional outbox** | The vector write cannot join the database transaction, so the *intent* is written as a row in the same transaction, and a worker drains it. Nothing is lost if the process dies between the two. |
| **`FOR UPDATE SKIP LOCKED`** | How a worker claims a job row without blocking other workers. Postgres as a queue. |
| **Advisory lock** | An application-level lock on a name, used so two simultaneous requests for the same topic candidate cannot both create it, and so two migration runners cannot both apply a file. |
| **Eventual consistency** | Qdrant lags Postgres by however long the outbox takes. This is why topic lookup also reads Postgres for same-name topics — searching only Qdrant would miss a topic created seconds ago. |
| **Cache hit / miss** | A candidate topic matching an existing one above `0.955` is a hit: content is reused for free. A miss costs a full pipeline run. |
| **Negative control** | Deliberately feeding a checker something it *must* reject, to prove it can. |
| **Retire, not delete** | A bad card is marked `retired_at` and disappears from every read through `live_scroll`, while its view history survives. |
| **Degraded** | The fact-*checker* failed, as opposed to the card failing. The topic stays `pending` and is retried; blaming the generator here would report a fake rejection rate. |

---

*Written 2026-09-18. When this disagrees with the code, the code is right — and the disagreement is worth a line in [DECISIONS.md](DECISIONS.md).*
