"""The outbox worker: drains committed intent into Qdrant (task 4c.5).

WHAT IT GUARANTEES: a topic is never left in Postgres without a vector being
owed. The topic row and the outbox row commit together, so by the time this
worker sees anything, the promise to write a vector is already durable. The
worker can crash, Qdrant can be down, the whole machine can restart - the
intent survives, because it is a row in the same database as the topic.

RETRY, THEN GIVE UP DELIBERATELY. Bounded attempts on exponential backoff, then
the row is dead-lettered as `failed` and left alone. It is NOT retried forever:
a poisoned row - malformed payload, or a dimension mismatch after a model change
- would spin indefinitely and surface only as a worker that never catches up.
Reconciliation finds "topic in Postgres with no vector" on its own schedule and
re-enqueues, so the two mechanisms layer rather than duplicate, and permanent
outbox failure degrades to the safety net instead of losing the topic.

THREE SEPARATE FAILURES ARE HANDLED, and they are not the same thing:
  - Qdrant is down          -> retryable, backoff, try again
  - the row is poisoned     -> retries exhaust, dead-letter, reconciliation owns it
  - the WORKER dies mid-row -> the row is stuck in `processing` and would be
                               invisible to every future claim. A reaper returns
                               stale `processing` rows to `pending`. Without it,
                               one crash silently strands a topic forever.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import asyncpg
import httpx

from app import metrics
from app.config import OUTBOX_BASE_BACKOFF_SECONDS, OUTBOX_MAX_ATTEMPTS
from app.embedding_text import topic_embedding_text
from app.stores.embeddings import embed_one
from app.stores.qdrant import TOPIC_NAME_COLLECTION, upsert_point

log = logging.getLogger(__name__)

# A row left in `processing` for longer than this is assumed to belong to a dead
# worker. Generous enough that a slow embed is never reaped mid-flight.
STALE_PROCESSING_SECONDS = 300


@dataclass
class DrainReport:
    claimed: int = 0
    written: int = 0
    retried: int = 0
    dead_lettered: int = 0
    reaped: int = 0

    @property
    def ok(self) -> bool:
        return self.written == self.claimed


async def reap_stale(conn: asyncpg.Connection) -> int:
    """Returns rows abandoned by a dead worker to the queue.

    Without this, a worker killed between claiming a row and finishing it leaves
    that row in `processing`, where no claim query will ever see it again - the
    topic keeps its vector owed forever and nothing reports it.
    """
    return int(
        await conn.fetchval(
            f"""
            WITH stale AS (
              UPDATE outbox
                 SET status = 'pending'
               WHERE status = 'processing'
                 AND created_at < now() - interval '{STALE_PROCESSING_SECONDS} seconds'
              RETURNING 1
            )
            SELECT count(*) FROM stale
            """
        )
        or 0
    )


async def claim(conn: asyncpg.Connection, limit: int) -> list[asyncpg.Record]:
    """Claims due rows atomically.

    FOR UPDATE SKIP LOCKED is what makes several workers safe: each takes rows
    the others have not locked, rather than all contending for the same head of
    the queue.

    Dead-lettered (`failed`) rows are deliberately NOT claimed here. They belong
    to reconciliation, which re-enqueues them on its own schedule - claiming them
    here would turn bounded retry back into an infinite loop.
    """
    return await conn.fetch(
        """
        WITH due AS (
          SELECT id FROM outbox
           WHERE status = 'pending' AND next_attempt_at <= now()
           ORDER BY created_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        UPDATE outbox o
           SET status = 'processing'
          FROM due
         WHERE o.id = due.id
        RETURNING o.id, o.topic_id, o.payload, o.attempts
        """,
        limit,
    )


async def _succeed(conn: asyncpg.Connection, row_id: int) -> None:
    await conn.execute(
        "UPDATE outbox SET status = 'done', processed_at = now() WHERE id = $1",
        row_id,
    )


async def _fail(conn: asyncpg.Connection, row_id: int, attempts: int, error: str) -> bool:
    """Schedules a retry, or dead-letters. Returns True if dead-lettered."""
    attempts += 1
    if attempts >= OUTBOX_MAX_ATTEMPTS:
        await conn.execute(
            "UPDATE outbox SET status='failed', attempts=$2, last_error=$3 WHERE id=$1",
            row_id,
            attempts,
            error[:500],
        )
        return True

    backoff = OUTBOX_BASE_BACKOFF_SECONDS * (2 ** (attempts - 1))
    await conn.execute(
        f"""
        UPDATE outbox
           SET status='pending', attempts=$2, last_error=$3,
               next_attempt_at = now() + interval '{backoff} seconds'
         WHERE id=$1
        """,
        row_id,
        attempts,
        error[:500],
    )
    return False


async def drain_once(
    conn: asyncpg.Connection, client: httpx.AsyncClient, *, limit: int = 20
) -> DrainReport:
    report = DrainReport()
    report.reaped = await reap_stale(conn)

    rows = await claim(conn, limit)
    report.claimed = len(rows)

    for row in rows:
        payload = row["payload"]
        if isinstance(payload, str):
            import json as _json

            payload = _json.loads(payload)

        try:
            text = topic_embedding_text(payload["name"], payload["description"])
            vector = await embed_one(client, text)
            await upsert_point(
                client,
                TOPIC_NAME_COLLECTION,
                point_id=str(row["topic_id"]),
                vector=vector,
                payload={"topic_id": str(row["topic_id"]), "name": payload["name"]},
            )
        except Exception as exc:  # noqa: BLE001 - any failure is a retryable outcome here
            dead = await _fail(conn, row["id"], row["attempts"], f"{type(exc).__name__}: {exc}")
            if dead:
                report.dead_lettered += 1
                log.error(
                    "outbox row %s dead-lettered for topic %s after %s attempts: %s",
                    row["id"], row["topic_id"], OUTBOX_MAX_ATTEMPTS, exc,
                )
            else:
                report.retried += 1
            continue

        await _succeed(conn, row["id"])
        report.written += 1

    metrics.outbox_written.inc(report.written)
    metrics.outbox_retried.inc(report.retried)
    metrics.outbox_dead_lettered.inc(report.dead_lettered)
    metrics.outbox_reaped.inc(report.reaped)
    return report


async def run_forever(dsn: str, client: httpx.AsyncClient, *, interval: float = 5.0) -> None:
    conn = await asyncpg.connect(dsn)
    try:
        while True:
            try:
                report = await drain_once(conn, client)
                if report.claimed or report.reaped:
                    log.info(
                        "outbox: claimed=%d written=%d retried=%d dead=%d reaped=%d",
                        report.claimed, report.written, report.retried,
                        report.dead_lettered, report.reaped,
                    )
            except Exception:
                # The loop must outlive one bad pass: a worker that exits on a
                # transient database blip strands every owed vector until
                # someone notices the process is gone.
                log.exception("outbox drain failed; continuing")
            await asyncio.sleep(interval)
    finally:
        await conn.close()
