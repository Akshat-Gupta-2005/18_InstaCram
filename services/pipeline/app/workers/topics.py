"""The topic worker (W5 task 5.4): claims pending topics and generates their cards.

A topic with status 'pending' IS the job (DECISIONS 2026-09-16). Serving creates
one on a cache miss, together with its outbox row, and never calls this service
directly - so serving can accept a request while the pipeline is down, and a
pipeline restart mid-run loses nothing.

Claiming sets `claimed_at` and nothing else. `status` stays 'pending' for the
whole run, because the feed reads 'pending' as "generating" and a topic being
worked on is still generating from the user's side. The graph moves it to 'ready'
or 'empty' when it finishes.

ONE TOPIC AT A TIME. The model runs locally on one machine; two topics in
parallel would contend for the same GPU and finish no sooner, while doubling the
chance that both time out. Throughput comes from running more workers against
more model capacity, which SKIP LOCKED already makes safe.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import asyncpg
import httpx

from app.config import TOPIC_CLAIM_STALE_SECONDS

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ClaimedTopic:
    id: str
    name: str
    description: str
    # Any field the topic is linked to. The scraper uses it to pick sources, and a
    # topic serving created always has at least one - it is linked in the same
    # transaction that creates it.
    field: str


async def claim_topic(
    conn: asyncpg.Connection, *, stale_seconds: int = TOPIC_CLAIM_STALE_SECONDS
) -> ClaimedTopic | None:
    """Claims the oldest claimable pending topic, or returns None.

    Claimable means never claimed, or claimed longer ago than the stale window -
    which is both how a dead worker's topic is recovered and how a `degraded` run
    backs off instead of retrying immediately.
    """
    row = await conn.fetchrow(
        """
        UPDATE topic t
        SET claimed_at = now()
        WHERE t.id = (
            SELECT id FROM topic
            WHERE status = 'pending'
              AND (claimed_at IS NULL
                   OR claimed_at < now() - make_interval(secs => $1))
            ORDER BY created_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING t.id, t.name, t.description,
          COALESCE((SELECT f.name FROM field_topic ft JOIN field f ON f.id = ft.field_id
                    WHERE ft.topic_id = t.id ORDER BY ft.created_at, f.name LIMIT 1), '') AS field
        """,
        stale_seconds,
    )
    if row is None:
        return None
    return ClaimedTopic(
        id=str(row["id"]), name=row["name"], description=row["description"], field=row["field"]
    )


async def process_one(conn: asyncpg.Connection, client: httpx.AsyncClient) -> str | None:
    """Claims and runs one topic. Returns its outcome, or None if nothing was claimable.

    An exception from the run is logged and swallowed. The claim is left in place,
    so the topic is retried after the stale window rather than immediately - the
    same backoff `degraded` gets, for the same reason: whatever broke is unlikely
    to have healed in the next five seconds.
    """
    # Imported here, not at module level: the graph pulls in LangGraph and every
    # agent, and the claim logic should be importable and testable without them.
    from app.graph.pipeline import run_topic

    topic = await claim_topic(conn)
    if topic is None:
        return None

    log.info("topic %s (%s): claimed, field=%r", topic.id, topic.name, topic.field)
    try:
        result = await run_topic(
            client,
            topic=topic.name,
            field=topic.field,
            description=topic.description,
            conn=conn,
            topic_id=topic.id,
        )
    except Exception:
        log.exception(
            "topic %s (%s): run failed; will be retried after %ss",
            topic.id, topic.name, TOPIC_CLAIM_STALE_SECONDS,
        )
        return "error"

    log.info(
        "topic %s (%s): %s, %d passed, %d failed",
        topic.id, topic.name, result.outcome, len(result.passed), len(result.failed),
    )
    return result.outcome


async def run_forever(dsn: str, client: httpx.AsyncClient, *, interval: float) -> None:
    """Drains every claimable topic, then sleeps. Reconnects if the database goes away.

    Reconnecting is not decoration. The first version of the outbox loop connected
    once, so a Postgres restart left it failing on a dead connection on every pass,
    forever, while appearing to run (P37).
    """
    conn: asyncpg.Connection | None = None
    while True:
        try:
            if conn is None or conn.is_closed():
                conn = await asyncpg.connect(dsn)
            while await process_one(conn, client) is not None:
                pass
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("topic worker pass failed; reconnecting on the next pass")
            if conn is not None and not conn.is_closed():
                await conn.close()
            conn = None
        await asyncio.sleep(interval)
