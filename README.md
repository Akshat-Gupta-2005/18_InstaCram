# InstaCram

A field-scoped, scroll-based microlearning app. You name a field — "Java Collections", "Behavioural Economics" — and get a feed of one-page, single-topic cards, each readable in about the time it takes to watch one short-form video.

It is built for **priming and revision**: seeing a concept briefly so you are not starting cold when it comes up later, and re-digesting material you have already half-learned. It is explicitly not a tool for learning complex subjects from zero. That boundary is a design decision, recorded in [Docs/DECISIONS.md](Docs/DECISIONS.md), not a gap waiting to be filled.

## Status

**W0 and W1 done: a working skeleton, no features yet.** The schema (verified by 22 invariant checks), the API contract and the agent prompts are written, and all six services come up healthy from one command. There's no feed, no pipeline and no LLM call yet. Current state is always in [Docs/FEATURES.md](Docs/FEATURES.md).

## Running it

```bash
cp .env.example .env
docker compose up -d --build

curl localhost:3000/health    # serving
curl localhost:8000/health    # pipeline
```

The serving service applies any pending database migrations each time it starts, before it begins listening. There is no separate migration step.

**Always start with `--build`.** Migrations ship inside the serving image. An image built before the latest migration would apply an older schema and still report success.

If serving exits instead of coming up, `docker compose logs serving` will show a line starting `MIGRATION FAILED` that names the cause.

No cloud account or API key is needed. The language model runs locally through **Ollama on your own machine**: keep `ollama serve` running and pull the model named in `services/llm-gateway/config.yaml` (`ollama pull qwen3:8b`). Switching to a hosted provider later is an edit to that one file and nothing else.

The first `docker compose up` downloads the embedding model into a named volume. That took 329 seconds when measured, and later starts reuse the cached copy.

### Working on one service

```bash
cd services/serving  && npm install && npm run dev
cd services/pipeline && pip install -e ".[dev]" && uvicorn app.main:app --reload
```

## How it works

Cache-then-generate. A field request is turned into candidate topic names by an LLM; each is checked against a vector database of existing topics. A match reuses the existing content under the new field at zero cost — topics are not owned by fields, which is what makes that possible. A miss triggers the generation pipeline: scrape for grounding, generate supplementary material, write draft cards, fact-check them. Failures are quarantined; passes are served as soon as they are ready.

[Docs/BUILD-PLAN.md](Docs/BUILD-PLAN.md) §2 has the architecture. [Docs/architecture-diagram.html](Docs/architecture-diagram.html) is the original planning-stage diagram. It predates the outbox, quarantine, retry and saves changes, so where the two differ, BUILD-PLAN is authoritative.

## Documentation

| File | What it is |
|---|---|
| [Docs/BUILD-PLAN.md](Docs/BUILD-PLAN.md) | Intent: stack, architecture, data model, core logic, phases |
| [Docs/FEATURES.md](Docs/FEATURES.md) | What is true right now — start here |
| [Docs/DECISIONS.md](Docs/DECISIONS.md) | Why it is this way. Append-only, including the reversals |
| [Docs/IMPLEMENTATION-PLAN.md](Docs/IMPLEMENTATION-PLAN.md) | Build order, W0–W7 |
| [Docs/API-CONTRACT.md](Docs/API-CONTRACT.md) | The contract both clients build against |
| [prompts/](prompts/) | The four LLM agents, with the reasoning behind each instruction |

## Layout

```
services/serving/      Node + Express + TS - fast read path, feed, accounts
services/pipeline/     Python + FastAPI - slow async generation, 5 agents
services/llm-gateway/  LiteLLM config - one endpoint, swappable provider
prompts/               Agent prompts, versioned with the code that runs them
Docs/                  Plan, current state, decisions, contract
```

The two backend services are split because their failure profiles differ: the read path must stay fast and available, while the pipeline is slow, bursty, and allowed to fail for one topic without taking a feed down.
