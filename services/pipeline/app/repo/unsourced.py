"""Writes to unsourced_topic - the record of topics a source could not ground.

The TABLE is the record; services/pipeline/sourcing/unsourced-topics.json is a
generated export of it (scripts/export_unsourced.py). A file is the wrong thing
for a container to write: it vanishes unless volume-mounted, concurrent topic
workers appending can interleave into invalid JSON, and "which field mismatches
most" becomes a manual read. See Docs/DECISIONS.md P26.

This UPSERTS rather than appends. A mismatch is the same fact re-observed, not a
new event: empty topics are retried on later requests (P16), so appending per
run would let one unsourceable topic flood the table. times_detected keeps the
count that an append would have spread across rows.
"""

from __future__ import annotations

import asyncpg

UPSERT = """
INSERT INTO unsourced_topic
  (topic_name, field_name, source, matched_title, kind, chars, note)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (lower(topic_name), source) DO UPDATE SET
  times_detected   = unsourced_topic.times_detected + 1,
  last_detected_at = now(),
  -- Refreshed because the source can change what it returns over time, and the
  -- latest observation is the one worth acting on.
  matched_title    = EXCLUDED.matched_title,
  kind             = EXCLUDED.kind,
  chars            = EXCLUDED.chars,
  note             = EXCLUDED.note
RETURNING times_detected
"""


async def record_mismatch(
    conn: asyncpg.Connection,
    *,
    topic: str,
    field: str | None,
    source: str,
    matched_title: str | None,
    kind: str,
    chars: int | None,
    note: str,
) -> int:
    """Records one mismatch and returns how many times it has now been seen.

    A return value above 1 means this topic has failed sourcing before - the
    signal that it needs a different source rather than another attempt.
    """
    return await conn.fetchval(
        UPSERT, topic, field, source, matched_title, kind, chars, note
    )


async def counts_by_field(conn: asyncpg.Connection) -> list[asyncpg.Record]:
    """The question the table exists to answer: which field needs another source."""
    # DISTINCT because a topic that failed every source has one row per source.
    # Counting rows would report "attempts", and a field would look worse simply
    # for having had more sources tried against it.
    #
    # resolved_at IS NULL because the question is which fields need a source NOW.
    # Before this filter existed the table reported five unsourced Java topics
    # that the Javadoc source had already grounded - stale, and still believed.
    return await conn.fetch(
        """
        SELECT field_name,
               count(DISTINCT lower(topic_name)) AS topics,
               sum(times_detected)               AS detections
        FROM unsourced_topic
        WHERE resolved_at IS NULL
        GROUP BY field_name
        ORDER BY topics DESC, field_name
        """
    )


async def mark_resolved(
    conn: asyncpg.Connection, *, topic: str, resolved_by: str
) -> int:
    """Called when any source finally grounds a topic that previously failed.

    Clears every source's row for the topic, not just the one that succeeded: the
    topic is sourced, so no field needs action on account of it. The rows stay,
    carrying which source failed and which one worked - that pairing is the
    evidence that justified adding a second source, and deleting it would make
    the next person rediscover it.
    """
    return await conn.fetchval(
        """
        WITH updated AS (
          UPDATE unsourced_topic
             SET resolved_at = now(), resolved_by = $2
           WHERE lower(topic_name) = lower($1)
             AND resolved_at IS NULL
          RETURNING 1
        )
        SELECT count(*) FROM updated
        """,
        topic,
        resolved_by,
    )
