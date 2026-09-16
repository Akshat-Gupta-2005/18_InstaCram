"""A real Postgres for the tests whose subject is SQL.

Most pipeline tests stub everything and need no database. The worker claim tests
cannot: SKIP LOCKED, a stale-claim window and a status the graph leaves alone are
properties of Postgres, and a mocked connection would test the mock.

The schema is built from the SAME migration files serving applies
(services/serving/src/db/migrations), in order. Not a hand-written copy - that
would drift from the real schema silently, which is the drift the serving test
setup exists to avoid too. Only the runner's bookkeeping is skipped, and that
table is not part of what is under test.

The database is rebuilt from nothing once per session. Locally that needs the
compose Postgres running; in CI the pipeline job declares a Postgres service,
because a job without one is how serving's tests failed on every push (P34).
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator

import asyncpg
import pytest

from app.config import REPO_ROOT

MIGRATIONS = REPO_ROOT / "services" / "serving" / "src" / "db" / "migrations"
TEST_DB = "instacram_pipeline_test"
ADMIN_URL = os.environ.get(
    "ADMIN_DATABASE_URL", "postgres://instacram:instacram@localhost:5432/postgres"
)
TEST_URL = os.environ.get(
    "PIPELINE_TEST_DATABASE_URL", f"postgres://instacram:instacram@localhost:5432/{TEST_DB}"
)


async def _rebuild() -> int:
    admin = await asyncpg.connect(ADMIN_URL)
    try:
        await admin.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        await admin.execute(f"CREATE DATABASE {TEST_DB}")
    finally:
        await admin.close()

    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        raise RuntimeError(f"no migrations found in {MIGRATIONS}")
    conn = await asyncpg.connect(TEST_URL)
    try:
        for f in files:
            await conn.execute(f.read_text(encoding="utf-8"))
    finally:
        await conn.close()
    return len(files)


@pytest.fixture(scope="session")
def test_database_url() -> str:
    # Synchronous and session-scoped on purpose: pytest-asyncio gives each test
    # its own event loop, and a connection cannot cross loops.
    asyncio.run(_rebuild())
    return TEST_URL


@pytest.fixture
async def db(test_database_url: str) -> AsyncIterator[asyncpg.Connection]:
    conn = await asyncpg.connect(test_database_url)
    await conn.execute(
        """TRUNCATE field, topic, field_topic, scroll, rejected_draft,
                    topic_generation_stats, outbox, field_expansion
           RESTART IDENTITY CASCADE"""
    )
    try:
        yield conn
    finally:
        await conn.close()
