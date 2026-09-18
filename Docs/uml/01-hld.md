# 01 — High-level design

Three zoom levels: the system in its world, the pieces inside it, and where those pieces physically run.

---

## 1.1 Context — the system and everything outside it

```mermaid
flowchart TB
    learner(["Learner<br/><i>wants priming or revision</i>"])

    subgraph instacram["InstaCram"]
        sys["Field-scoped microlearning cards<br/>name a field, get one-page cards"]
    end

    wiki["Wikipedia / Wikimedia<br/><i>grounding source</i>"]
    javadoc["Oracle Javadoc<br/><i>grounding source for classes<br/>an encyclopedia has no page for</i>"]
    ollama["Ollama on the host<br/><i>qwen3:8b, local, no API key</i>"]
    firebase["Firebase Auth<br/><i>PLANNED - Google sign-in</i>"]

    learner -->|"names a field, reads cards,<br/>saves, revises"| sys
    sys -->|"HTTPS, identified User-Agent,<br/>respects robots.txt"| wiki
    sys -->|"deterministic URL per class"| javadoc
    sys -->|"every LLM call"| ollama
    sys -.->|"not built yet"| firebase

    classDef planned stroke-dasharray: 5 5
    class firebase planned
```

**What to notice.** Every external dependency except the two sources is *local*. There is no cloud LLM, no managed vector service, no third-party analytics. The cost of a generated card is electricity, and the system can run with the network off once a model is pulled — which is why measuring cost per topic was possible at all.

The scraper identifies itself honestly. That is a rule, not an accident: Wikimedia answers `403` without a contact in the User-Agent, and the pipeline's topic worker **refuses to start** rather than scraping anonymously.

---

## 1.2 Containers — what runs, and what each one owns

```mermaid
flowchart TB
    subgraph client["Client tier"]
        app["Expo app<br/>web · iOS · Android<br/><i>TypeScript, Expo Router</i><br/>:8082 dev server"]
    end

    subgraph fast["Fast path — answers in milliseconds"]
        serving["<b>serving</b> :3000<br/><i>Node 22 · Express · TS</i><br/>feed · auth · views · saves<br/>topic resolution · expansion worker"]
    end

    subgraph slow["Slow path — answers in minutes"]
        pipeline["<b>pipeline</b> :8000<br/><i>Python 3.12 · FastAPI · LangGraph</i><br/>4 agents · topic worker · outbox worker"]
    end

    subgraph data["State"]
        pg[("<b>postgres</b> :5432<br/>SOURCE OF TRUTH<br/>15 tables · every queue")]
        qd[("<b>qdrant</b> :6333<br/>DERIVED<br/>topic_names · scroll_contents<br/>768 dims, cosine")]
    end

    subgraph models["Model serving"]
        emb["<b>embeddings</b> :8081→:80<br/><i>HF TEI, e5-base-v2</i><br/>hottest call in the system"]
        gw["<b>llm-gateway</b> :4000<br/><i>LiteLLM</i><br/>the model is a config value"]
        oll["<b>Ollama</b> :11434<br/><i>on the host, not a container</i>"]
    end

    app -->|"HTTPS + bearer token"| serving
    serving --> pg
    serving --> qd
    serving --> emb
    serving --> gw
    pipeline --> pg
    pipeline --> qd
    pipeline --> emb
    pipeline --> gw
    gw --> oll
    pipeline -->|"plain HTTP, no browser"| web["Wikipedia · Javadoc"]

    serving -.->|"writes topic status=pending<br/><b>THE ONLY HANDOFF</b>"| pg
    pg -.->|"claims it<br/>FOR UPDATE SKIP LOCKED"| pipeline

    classDef fastcls fill:#dbeafe,stroke:#2563eb
    classDef slowcls fill:#ede9fe,stroke:#7c3aed
    classDef infra fill:#f1f5f9,stroke:#64748b
    class serving fastcls
    class pipeline slowcls
    class pg,qd,emb,gw,oll,web infra
```

**What to notice.**

1. **No arrow between serving and pipeline.** The dashed pair through Postgres is the entire integration. Either service can be restarted, rebuilt or broken without the other losing a job.
2. **Both services talk to the same four things**, and both must agree on two settings — the embedded text prefix and the match threshold. If they disagree, vectors written by one will never match vectors searched by the other, silently. That is why `docker-compose.yml` forwards those variables into both containers explicitly.
3. **Qdrant is derived.** Delete it and `reindex` rebuilds it from Postgres. The reverse is not true, and nothing is designed as though it were.
4. **Embeddings bypass the LLM gateway.** One is a hot, high-volume, small-model call; the other is a slow, low-volume, large-model call. Routing both through one gateway would put the hot path behind the slow one's queue.

---

## 1.3 Deployment — where it physically runs today

```mermaid
flowchart TB
    subgraph host["Your machine — Windows"]
        direction TB

        subgraph ollama_node["Host process"]
            oll["ollama serve :11434<br/>model weights + GPU live here"]
        end

        subgraph expo_node["Host process"]
            expo["expo start --web :8082<br/><i>8081 is taken by embeddings</i>"]
        end

        subgraph docker["Docker Desktop — compose project 'instacram'<br/>network: instacram_default"]
            c1["postgres:16-alpine<br/>:5432"]
            c2["qdrant/qdrant:v1.12.1<br/>:6333"]
            c3["text-embeddings-inference:cpu-1.9.3<br/>:8081→:80  <i>tag pinned exactly</i>"]
            c4["litellm:main-latest<br/>:4000"]
            c5["serving <i>built from repo root</i><br/>:3000  migrate && serve"]
            c6["pipeline <i>built from repo root</i><br/>:8000  uvicorn + 2 workers"]

            v1[("volume<br/>pgdata")]
            v2[("volume<br/>qdrantdata")]
            v3[("volume<br/>embeddingcache")]
        end

        browser["Chrome"]
    end

    c1 --- v1
    c2 --- v2
    c3 --- v3
    c4 -->|"host.docker.internal:11434<br/>extra_hosts maps it on Linux too"| oll
    browser --> expo
    browser -->|"direct API calls<br/>CORS_ORIGINS must list :8082"| c5
    c5 -->|"depends_on: service_healthy"| c1
    c6 -->|"depends_on: service_healthy"| c1

    classDef vol fill:#fef9c3,stroke:#ca8a04
    class v1,v2,v3 vol
```

**What to notice.**

- **Two processes are not containers**, and both are easy to forget: Ollama (weights and GPU are on the host) and the Expo dev server. If generation silently never happens, Ollama is the first thing to check — the gateway's health endpoint returns `200` regardless.
- **The browser calls the API directly**, not through the Expo server. So the API's CORS list, not the dev server, decides whether the app works.
- **Three named volumes hold everything you would miss:** the database, the vectors, and the cached embedding model (a 289–329s download). `docker compose down` keeps them. `docker compose down -v` destroys all three.
- **Only Postgres has a healthcheck others wait on.** Qdrant, embeddings and the gateway are used lazily; a call that arrives before they are ready fails and is retried rather than blocking startup.
- **Nothing here is deployed anywhere.** K8s manifests, Prometheus, Grafana and a real ingress are W7. The `/metrics` endpoint exists; nothing scrapes it.
