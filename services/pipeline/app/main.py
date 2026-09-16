"""InstaCram generation pipeline service.

Serves /health and /metrics, and runs the two background workers that make the
pipeline do anything at all: the outbox drain (owed topic vectors -> Qdrant) and
the topic worker (pending topics -> cards).

Until 2026-09-16 this module started neither. The outbox worker was built and
proven by scripts that called `drain_once` by hand, and the deployed service never
ran it, so owed vectors sat untouched for hours while every check passed (P37).
That is why worker state is reported by /health rather than assumed.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response

from app import metrics

# Importing config loads the repo-root .env by explicit path. A bare
# load_dotenv() used to live here and never found it, because this service runs
# with services/pipeline as its working directory. See P25.
from app.config import DATABASE_URL, PIPELINE_WORKERS, TOPIC_POLL_SECONDS

VERSION = "0.1.0"

log = logging.getLogger(__name__)

# name -> the running task, or a string saying why it is not running.
_workers: dict[str, asyncio.Task[None] | str] = {}


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    if not PIPELINE_WORKERS:
        _workers["outbox"] = "disabled: PIPELINE_WORKERS=off"
        _workers["topics"] = "disabled: PIPELINE_WORKERS=off"
        yield
        return

    # Imported inside, so importing this module (as the tests do) pulls in
    # neither LangGraph nor the agents.
    import httpx

    from app.agents.scraper import ContactNotConfigured, build_client
    from app.workers import outbox, topics

    outbox_client = httpx.AsyncClient()
    _workers["outbox"] = asyncio.create_task(outbox.run_forever(DATABASE_URL, outbox_client))

    topic_client: httpx.AsyncClient | None = None
    try:
        topic_client = build_client()
    except ContactNotConfigured:
        # The outbox still runs - it needs no scraping. Topics cannot be grounded
        # without an identified User-Agent, so the worker is not started, and
        # /health says so instead of the service pretending to generate.
        _workers["topics"] = "disabled: SCRAPER_CONTACT is not set"
    else:
        _workers["topics"] = asyncio.create_task(
            topics.run_forever(DATABASE_URL, topic_client, interval=TOPIC_POLL_SECONDS)
        )

    log.info("workers: %s", {k: _state(v) for k, v in _workers.items()})
    try:
        yield
    finally:
        for worker in _workers.values():
            if isinstance(worker, asyncio.Task):
                worker.cancel()
        await asyncio.gather(
            *(w for w in _workers.values() if isinstance(w, asyncio.Task)),
            return_exceptions=True,
        )
        await outbox_client.aclose()
        if topic_client is not None:
            await topic_client.aclose()


app = FastAPI(title="InstaCram Pipeline", version=VERSION, lifespan=lifespan)

# What an unreachable or unhealthy database actually raises: connection refused or
# DNS failure (OSError), a timeout, or an error reported by Postgres itself.
_DB_ERRORS = (OSError, TimeoutError, asyncpg.PostgresError)


def _state(worker: asyncio.Task[None] | str) -> str:
    if isinstance(worker, str):
        return worker
    if not worker.done():
        return "running"
    if worker.cancelled():
        return "stopped: cancelled"
    exc = worker.exception()
    return f"stopped: {type(exc).__name__}: {exc}" if exc else "stopped"


async def db_healthy() -> bool:
    try:
        conn = await asyncpg.connect(DATABASE_URL, timeout=3)
    except _DB_ERRORS:
        return False
    try:
        await conn.execute("SELECT 1")
        return True
    except _DB_ERRORS:
        return False
    finally:
        await conn.close()


@app.get("/metrics")
async def prometheus_metrics() -> Response:
    """Task 4c.8. Scraped by Prometheus; the two services get separate panels
    because they fail differently - serving latency versus pipeline throughput.

    Deliberately unauthenticated and on the same port as /health, matching how
    the rest of the local stack works. W7 decides whether it moves to a separate
    port before anything is network-exposed.
    """
    payload, content_type = metrics.render()
    return Response(content=payload, media_type=content_type)


@app.get("/health")
async def health() -> JSONResponse:
    """503 when the database is unreachable OR an enabled worker has stopped.

    A disabled worker is a configuration choice and does not fail the check. A
    stopped one does: a pipeline whose workers have died answers every request
    and generates nothing, which is the exact silent state P37 was.
    """
    db_ok = await db_healthy()
    workers = {name: _state(w) for name, w in _workers.items()}
    worker_died = any(state.startswith("stopped") for state in workers.values())
    healthy = db_ok and not worker_died
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={
            "status": "ok" if healthy else "degraded",
            "service": "pipeline",
            "db": "ok" if db_ok else "unreachable",
            "workers": workers,
            "version": VERSION,
        },
    )
