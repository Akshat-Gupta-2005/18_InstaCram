"""InstaCram generation pipeline service.

Triggered on a cache miss, per topic. The LangGraph definition of the five steps
lands in app/graph/ at W4; this is the W1 skeleton.
"""

import asyncpg
from fastapi import FastAPI
from fastapi.responses import JSONResponse

# Importing config loads the repo-root .env by explicit path. A bare
# load_dotenv() used to live here and never found it, because this service runs
# with services/pipeline as its working directory. See P25.
from app.config import DATABASE_URL

VERSION = "0.1.0"

app = FastAPI(title="InstaCram Pipeline", version=VERSION)


# What an unreachable or unhealthy database actually raises: connection refused or
# DNS failure (OSError), a timeout, or an error reported by Postgres itself.
_DB_ERRORS = (OSError, TimeoutError, asyncpg.PostgresError)


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


@app.get("/health")
async def health() -> JSONResponse:
    db_ok = await db_healthy()
    return JSONResponse(
        status_code=200 if db_ok else 503,
        content={
            "status": "ok" if db_ok else "degraded",
            "service": "pipeline",
            "db": "ok" if db_ok else "unreachable",
            "version": VERSION,
        },
    )
