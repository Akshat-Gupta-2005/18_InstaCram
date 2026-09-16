"""Everything the pipeline writes to Postgres.

The write order is Postgres first, always. Postgres is the source of truth and
every vector is derived from it, so the failure directions are asymmetric: a
topic with no vector is invisible and regenerates - waste. A vector with no topic
matches a lookup and then resolves to nothing - a reported cache hit that errors
on serving. Corruption is worse than waste, so the derived store goes second
(§4.6, P11).
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import asyncpg

from app.agents.card_gen import Draft


@dataclass(frozen=True)
class TopicRow:
    id: str
    name: str
    description: str


async def create_topic_with_outbox(
    conn: asyncpg.Connection, *, name: str, description: str
) -> TopicRow:
    """Task 4c.4. The topic row and its outbox row commit TOGETHER or not at all.

    This is the whole mechanism behind invariant 5 (every topic has exactly one
    vector). The two stores share no transaction, so the intent to write the
    vector is committed atomically with the topic itself; a worker then drains
    that intent. A vector write can fail, retry, or be abandoned, and the topic
    can never be left invisible-but-present with nothing recording that a vector
    is owed.

    Note what is NOT done here: no embedding call, no Qdrant write. Doing either
    inline would put a network call inside the transaction that must not fail,
    which is the thing the outbox exists to avoid.
    """
    async with conn.transaction():
        row = await conn.fetchrow(
            """
            INSERT INTO topic (name, description)
            VALUES ($1, $2)
            RETURNING id, name, description
            """,
            name,
            description,
        )
        await conn.execute(
            """
            INSERT INTO outbox (topic_id, payload)
            VALUES ($1, $2::jsonb)
            """,
            row["id"],
            # The payload carries what the worker needs to build the vector, so a
            # retry hours later embeds the same text even if anything else moved.
            # Safe because invariant 9 makes `description` write-once anyway.
            json.dumps({"name": row["name"], "description": row["description"]}),
        )
    return TopicRow(id=str(row["id"]), name=row["name"], description=row["description"])


async def persist_scroll(
    conn: asyncpg.Connection, *, topic_id: str, draft: Draft
) -> str:
    """Task 4c.1. One card that cleared the gate.

    The schema enforces invariant 4 (source_url NOT NULL, trust_label checked).
    The card generator validates the same things first so a bad draft is
    quarantined with a readable reason instead of arriving as a constraint
    violation naming a column.
    """
    return str(
        await conn.fetchval(
            """
            INSERT INTO scroll
              (topic_id, content, source_url, trust_label,
               why_it_matters, recall_prompt, recall_answer)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
            """,
            topic_id,
            draft.content,
            draft.source_url,
            draft.trust_label,
            draft.why_it_matters,
            draft.recall_prompt,
            draft.recall_answer,
        )
    )


async def quarantine_draft(
    conn: asyncpg.Connection, *, topic_id: str, content: str, reason: str
) -> None:
    """Task 4c.2. A rejected draft, kept for diagnosis.

    A separate table, never a flag on `scroll` (invariant 10): a boolean on the
    served table is one forgotten WHERE clause away from serving unverified
    content, and the entire point of the gate is that this cannot happen. The
    cap of 20 per topic is enforced by a trigger from migration 002.
    """
    await conn.execute(
        "INSERT INTO rejected_draft (topic_id, content, reason) VALUES ($1, $2, $3)",
        topic_id,
        content,
        reason,
    )


async def record_run(
    conn: asyncpg.Connection,
    *,
    topic_id: str,
    generated: int,
    passed: int,
    failed: int,
) -> None:
    """Task 4c.2/4c.3. Per-topic counters, kept forever.

    An over-strict fact-checker and a weak card generator produce the IDENTICAL
    rejection rate; the counters say how often, the quarantined text says which.
    `runs` increments per pipeline run, so `runs > 1` means the topic came back
    empty and was retried - which matters because that retry has no attempt limit
    (P10, P16, migration 003).
    """
    await conn.execute(
        """
        INSERT INTO topic_generation_stats
          (topic_id, drafts_generated, drafts_passed, drafts_failed, runs, run_at)
        VALUES ($1, $2, $3, $4, 1, now())
        ON CONFLICT (topic_id) DO UPDATE SET
          drafts_generated = topic_generation_stats.drafts_generated + EXCLUDED.drafts_generated,
          drafts_passed    = topic_generation_stats.drafts_passed    + EXCLUDED.drafts_passed,
          drafts_failed    = topic_generation_stats.drafts_failed    + EXCLUDED.drafts_failed,
          runs             = topic_generation_stats.runs + 1,
          run_at           = now()
        """,
        topic_id,
        generated,
        passed,
        failed,
    )


async def set_topic_status(
    conn: asyncpg.Connection, *, topic_id: str, status: str
) -> None:
    """`pending` -> `ready` when a card survives, or `empty` when none does.

    Task 4c.3's case is the second one, and it is not cosmetic: without `empty`,
    a topic whose drafts all failed is indistinguishable from a healthy one whose
    cards have not loaded, AND the lookup treats it as a valid cache hit - so the
    failure is cached and served as success forever (P10).
    """
    await conn.execute("UPDATE topic SET status = $1 WHERE id = $2", status, topic_id)


async def link_field_topic(
    conn: asyncpg.Connection, *, field_id: str, topic_id: str
) -> None:
    """One row is the entire cost of surfacing an existing topic under a field.

    Idempotent by primary key, so re-requesting a field cannot duplicate a link
    (invariant 2).
    """
    await conn.execute(
        """
        INSERT INTO field_topic (field_id, topic_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        """,
        field_id,
        topic_id,
    )
