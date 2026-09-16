"""Two-way reconciliation (task 4c.6) and reindex (task 4c.7).

The outbox is the fast path and this is the safety net behind it. They layer
rather than duplicate: the outbox covers writes it was asked to make, and
reconciliation covers everything else - including the writes it gave up on.

THE TWO DIRECTIONS ARE NOT SYMMETRIC, and they get opposite treatment:

  topic with no vector  -> RE-ENQUEUE. The topic is real and invisible to every
                           lookup, so it regenerates forever. Waste, recoverable.

  vector with no topic  -> DELETE. It matches a lookup and then resolves to
                           nothing, turning a reported cache hit into a serving
                           error. Corruption, and not self-correcting.

Postgres is the source of truth and every vector is derived from it, which is
what makes deleting the orphan the safe move rather than a data-loss risk.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import asyncpg
import httpx

from app.embedding_text import topic_embedding_text
from app.stores.embeddings import embed
from app.stores.qdrant import (
    SCROLL_CONTENT_COLLECTION,
    TOPIC_NAME_COLLECTION,
    all_point_ids,
    delete_points,
    upsert_point,
)

log = logging.getLogger(__name__)


@dataclass
class ReconcileReport:
    topics: int = 0
    vectors: int = 0
    missing_vectors: int = 0
    orphan_vectors: int = 0
    re_enqueued: int = 0
    dead_letters_revived: int = 0
    orphans_deleted: int = 0

    @property
    def consistent(self) -> bool:
        return self.missing_vectors == 0 and self.orphan_vectors == 0


async def reconcile(
    conn: asyncpg.Connection, client: httpx.AsyncClient, *, delete_orphans: bool = True
) -> ReconcileReport:
    report = ReconcileReport()

    topic_rows = await conn.fetch("SELECT id, name, description FROM topic")
    topic_ids = {str(r["id"]) for r in topic_rows}
    report.topics = len(topic_ids)

    vector_ids = await all_point_ids(client, TOPIC_NAME_COLLECTION)
    report.vectors = len(vector_ids)

    missing = topic_ids - vector_ids
    orphans = vector_ids - topic_ids
    report.missing_vectors = len(missing)
    report.orphan_vectors = len(orphans)

    # A dead-lettered row is exactly a topic whose vector the outbox gave up on,
    # so reviving it is what makes bounded retry safe rather than lossy.
    if missing:
        report.dead_letters_revived = int(
            await conn.fetchval(
                """
                WITH revived AS (
                  UPDATE outbox
                     SET status='pending', attempts=0, next_attempt_at=now()
                   WHERE status='failed' AND topic_id::text = ANY($1::text[])
                  RETURNING 1
                )
                SELECT count(*) FROM revived
                """,
                list(missing),
            )
            or 0
        )

        # A topic can also be missing a vector with no outbox row at all - one
        # that was marked done against a collection later dropped, or a row
        # pruned. Write a fresh intent rather than assuming one exists.
        by_id = {str(r["id"]): r for r in topic_rows}
        for topic_id in missing:
            row = by_id[topic_id]
            inserted = await conn.fetchval(
                """
                INSERT INTO outbox (topic_id, payload)
                SELECT $1, $2::jsonb
                 WHERE NOT EXISTS (
                   SELECT 1 FROM outbox
                    WHERE topic_id = $1 AND status IN ('pending','processing')
                 )
                RETURNING 1
                """,
                row["id"],
                json.dumps({"name": row["name"], "description": row["description"]}),
            )
            if inserted:
                report.re_enqueued += 1

    if orphans and delete_orphans:
        await delete_points(client, TOPIC_NAME_COLLECTION, sorted(orphans))
        report.orphans_deleted = len(orphans)

    return report


async def reindex(conn: asyncpg.Connection, client: httpx.AsyncClient) -> dict[str, int]:
    """Task 4c.7. Rebuilds both collections from Postgres.

    Built early and independently of the outbox, because it is already required
    by an unrelated fact: the first embedding-model change invalidates every
    vector in both collections, and rebuilding from Postgres is the only way
    back. Writing it while the corpus is small means it is tested when running it
    is instant, rather than written under pressure when it is not.

    It does NOT create collections. `npm run vectors:ensure` owns that, and a
    second creator is a second chance to disagree about vector size or metric.
    """
    written = {"topic_names": 0, "scroll_contents": 0}

    topics = await conn.fetch("SELECT id, name, description FROM topic")
    if topics:
        texts = [topic_embedding_text(r["name"], r["description"]) for r in topics]
        vectors = await embed(client, texts)
        for row, vector in zip(topics, vectors, strict=True):
            await upsert_point(
                client,
                TOPIC_NAME_COLLECTION,
                point_id=str(row["id"]),
                vector=vector,
                payload={"topic_id": str(row["id"]), "name": row["name"]},
            )
            written["topic_names"] += 1

    # Retired cards are excluded: live_scroll is the view every read path uses,
    # and a retired card should not surface from a semantic search either.
    scrolls = await conn.fetch("SELECT id, topic_id, content FROM live_scroll")
    if scrolls:
        vectors = await embed(client, [r["content"] for r in scrolls])
        for row, vector in zip(scrolls, vectors, strict=True):
            await upsert_point(
                client,
                SCROLL_CONTENT_COLLECTION,
                point_id=str(row["id"]),
                vector=vector,
                payload={"scroll_id": str(row["id"]), "topic_id": str(row["topic_id"])},
            )
            written["scroll_contents"] += 1

    return written
