"""The topic worker's claim, against real Postgres (task 5.4).

The claim is the whole contract between serving and the pipeline: serving writes a
pending topic and walks away. If two workers could claim one topic, it is generated
twice; if a dead worker's claim never expires, the topic reports `generating`
forever; if a `degraded` run is reclaimed at once, a broken fact-checker is retried
in a hot loop. Each of those is a test here, and the concurrency one is FORCED
rather than timed - an earlier race test passed with its lock deleted (P35).
"""

from __future__ import annotations

import asyncio

import asyncpg
import pytest

from app.workers import topics
from app.workers.topics import claim_topic, process_one


async def make_topic(
    db: asyncpg.Connection,
    name: str,
    *,
    status: str = "pending",
    field: str | None = "Java Collections",
    claimed_ago_seconds: int | None = None,
) -> str:
    topic_id = await db.fetchval(
        "INSERT INTO topic (name, description, status) VALUES ($1, $2, $3) RETURNING id",
        name,
        f"{name} description",
        status,
    )
    if claimed_ago_seconds is not None:
        await db.execute(
            "UPDATE topic SET claimed_at = now() - make_interval(secs => $2) WHERE id = $1",
            topic_id,
            claimed_ago_seconds,
        )
    if field is not None:
        field_id = await db.fetchval(
            """INSERT INTO field (name) VALUES ($1)
               ON CONFLICT (name_norm) DO UPDATE SET name = field.name RETURNING id""",
            field,
        )
        await db.execute(
            "INSERT INTO field_topic (field_id, topic_id) VALUES ($1, $2)", field_id, topic_id
        )
    return str(topic_id)


async def test_claims_a_pending_topic_with_its_field(db: asyncpg.Connection) -> None:
    topic_id = await make_topic(db, "TreeMap")

    claimed = await claim_topic(db)

    assert claimed is not None
    assert (claimed.id, claimed.name, claimed.field) == (topic_id, "TreeMap", "Java Collections")
    row = await db.fetchrow("SELECT status, claimed_at FROM topic WHERE id = $1", topic_id)
    # Still 'pending': the feed reads that as generating, which a topic being
    # worked on still is. Only the claim changes.
    assert row["status"] == "pending"
    assert row["claimed_at"] is not None


async def test_claims_oldest_first(db: asyncpg.Connection) -> None:
    first = await make_topic(db, "First")
    await make_topic(db, "Second")
    claimed = await claim_topic(db)
    assert claimed is not None and claimed.id == first


async def test_never_claims_a_ready_or_empty_topic(db: asyncpg.Connection) -> None:
    await make_topic(db, "Done", status="ready")
    await make_topic(db, "Failed", status="empty")
    assert await claim_topic(db) is None


async def test_does_not_reclaim_a_topic_claimed_recently(db: asyncpg.Connection) -> None:
    # Covers both a run still in progress and a `degraded` run backing off.
    await make_topic(db, "InFlight", claimed_ago_seconds=60)
    assert await claim_topic(db, stale_seconds=1800) is None


async def test_reclaims_a_topic_whose_worker_died(db: asyncpg.Connection) -> None:
    # Without this a topic stays 'pending' - "generating" - forever.
    topic_id = await make_topic(db, "Orphaned", claimed_ago_seconds=3600)
    claimed = await claim_topic(db, stale_seconds=1800)
    assert claimed is not None and claimed.id == topic_id


async def test_a_topic_with_no_field_is_still_claimable(db: asyncpg.Connection) -> None:
    await make_topic(db, "Unlinked", field=None)
    claimed = await claim_topic(db)
    assert claimed is not None and claimed.field == ""


async def test_two_workers_never_claim_the_same_topic(
    db: asyncpg.Connection, test_database_url: str
) -> None:
    # FORCED interleaving. Worker A claims inside an open transaction, so its row
    # stays locked and uncommitted while worker B claims. SKIP LOCKED must hand B
    # the OTHER topic immediately. Without it, B blocks on A's lock - bounded here
    # by a timeout, so that regression fails as a clear TimeoutError rather than
    # hanging the suite.
    a_id = await make_topic(db, "Alpha")
    b_id = await make_topic(db, "Beta")

    worker_a = await asyncpg.connect(test_database_url)
    worker_b = await asyncpg.connect(test_database_url)
    try:
        tx = worker_a.transaction()
        await tx.start()
        claimed_a = await claim_topic(worker_a)

        claimed_b = await asyncio.wait_for(claim_topic(worker_b), timeout=3)

        await tx.commit()
    finally:
        await worker_a.close()
        await worker_b.close()

    assert claimed_a is not None and claimed_b is not None
    assert {claimed_a.id, claimed_b.id} == {a_id, b_id}


class _Result:
    def __init__(self, outcome: str) -> None:
        self.outcome = outcome
        self.passed: list[object] = []
        self.failed: list[object] = []


@pytest.fixture
def fake_run(monkeypatch: pytest.MonkeyPatch):
    """Replaces the graph. What is under test is what the WORKER does around a
    run, not the run - the graph has its own tests."""
    calls: list[str] = []

    def install(behaviour):
        async def run_topic(_client, *, topic, field, description, conn, topic_id):
            calls.append(topic_id)
            return await behaviour(conn, topic_id)

        from app.graph import pipeline

        monkeypatch.setattr(pipeline, "run_topic", run_topic)
        return calls

    return install


async def test_a_degraded_run_backs_off_instead_of_retrying_at_once(
    db: asyncpg.Connection, fake_run
) -> None:
    # `degraded` leaves the topic 'pending' by design (the checker failed, not the
    # cards). If the worker cleared the claim, the very next pass would claim it
    # again - a broken fact-checker hammered every five seconds.
    async def degraded(_conn, _topic_id):
        return _Result("degraded")

    calls = fake_run(degraded)
    topic_id = await make_topic(db, "Flaky")

    assert await process_one(db, client=None) == "degraded"
    assert await process_one(db, client=None) is None
    assert calls == [topic_id]


async def test_a_run_that_raises_keeps_its_claim(db: asyncpg.Connection, fake_run) -> None:
    async def boom(_conn, _topic_id):
        raise RuntimeError("llm gateway unreachable")

    calls = fake_run(boom)
    await make_topic(db, "Broken")

    assert await process_one(db, client=None) == "error"
    assert await process_one(db, client=None) is None
    assert len(calls) == 1


async def test_a_finished_topic_is_not_claimed_again(db: asyncpg.Connection, fake_run) -> None:
    async def ready(conn, topic_id):
        await conn.execute("UPDATE topic SET status = 'ready' WHERE id = $1", topic_id)
        return _Result("ready")

    calls = fake_run(ready)
    await make_topic(db, "Good")
    await make_topic(db, "AlsoGood")

    assert await process_one(db, client=None) == "ready"
    assert await process_one(db, client=None) == "ready"
    assert await process_one(db, client=None) is None
    assert len(calls) == 2


def test_the_module_imports_without_the_graph() -> None:
    # topics.py imports the graph lazily, so the claim logic stays importable -
    # and testable - without LangGraph and every agent.
    assert hasattr(topics, "claim_topic")
