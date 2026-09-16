/**
 * One candidate topic -> link an existing topic, or create a pending one.
 *
 * This is the branch "cache-then-generate" is named for (task 5.1), and the
 * reason the pipeline runs at all. Every outcome writes exactly one Field_Topic
 * link; only a miss creates a topic, and a created topic is born 'pending', which
 * IS the pipeline's job (DECISIONS 2026-09-16: Postgres as the queue).
 *
 * THE RACE, and why the lock is not enough on its own. Topic names are not unique
 * (polysemy), so two simultaneous requests proposing the same candidate could each
 * miss and each create it - two identical topics, two 113s pipeline runs. A
 * transaction-scoped advisory lock on the normalised name serialises them. But the
 * second request, once it gets the lock, cannot rely on Qdrant to see the first
 * request's topic: its vector is written ASYNCHRONOUSLY by the outbox and will not
 * be there for seconds. So under the lock the lookup also reads Postgres for
 * topics of the same name and compares them directly. A lock around a read of an
 * eventually-consistent store would serialise nothing that matters.
 *
 * Network calls stay OUTSIDE the transaction where possible: the candidate is
 * embedded and Qdrant searched before the lock is taken. Only a same-name topic
 * with no score yet is embedded under the lock - rare, one short sentence, and it
 * blocks only requests for that exact name.
 */
import type { PoolClient } from "pg";
import { cosine } from "../embeddings/client.js";
import { pool } from "../db/pool.js";
import type { TopicHit } from "../vectors/topicIndex.js";
import type { Candidate } from "./candidates.js";
import { topicEmbeddingText } from "./embeddingText.js";

export type ResolutionOutcome =
  /** Matched a topic that already has cards. Pipeline never runs (§4.1). */
  | "reused"
  /** Matched a topic already queued or generating. Nothing new is queued. */
  | "joined"
  /** Matched a topic whose last run produced nothing; sent back to the queue. */
  | "requeued"
  /** No match. A new pending topic now exists, with its vector owed. */
  | "created";

export interface Resolution {
  outcome: ResolutionOutcome;
  topicId: string;
  /** The similarity that decided a match; null for a created topic. */
  score: number | null;
}

/**
 * Injected so the SQL, locking and outbox behaviour can be tested against real
 * Postgres in CI, where neither Qdrant nor the embedding server exists. The
 * search adapter itself is verified against the real index separately
 * (src/vectors/verifyTopicIndex.ts).
 */
export interface ResolveDeps {
  embed: (texts: string[]) => Promise<number[][]>;
  search: (vector: number[], limit: number) => Promise<TopicHit[]>;
  threshold: number;
  /**
   * Called under the lock, after every lookup and before the decision to link or
   * create. Production never sets it. It exists because the race test first
   * written for this function PASSED WITH THE LOCK REMOVED: the transactions are
   * short enough that eight "simultaneous" requests serialised themselves by
   * accident, so the test could not fail and proved nothing. A barrier here forces
   * the interleaving instead of hoping for it (the lesson of P31 and P33).
   */
  beforeDecide?: () => Promise<void>;
}

interface TopicRow {
  id: string;
  name: string;
  description: string;
  status: "pending" | "ready" | "empty";
  created_at: Date;
}

interface Match {
  topic: TopicRow;
  score: number;
}

const SEARCH_LIMIT = 5;

/** Scores this close are treated as equal when choosing between matches. */
const SCORE_EPSILON = 1e-4;

export async function resolveCandidate(
  fieldId: string,
  candidate: Candidate,
  deps: ResolveDeps,
): Promise<Resolution> {
  const text = topicEmbeddingText(candidate.name, candidate.description);
  const [vector] = await deps.embed([text]);
  if (!vector) throw new Error("embedding server returned no vector for the candidate");

  const hits = await deps.search(vector, SEARCH_LIMIT);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const resolution = await resolveLocked(client, fieldId, candidate, vector, hits, deps);
      await client.query("COMMIT");
      return resolution;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
  }
}

async function resolveLocked(
  client: PoolClient,
  fieldId: string,
  candidate: Candidate,
  vector: number[],
  hits: TopicHit[],
  deps: ResolveDeps,
): Promise<Resolution> {
  // Released automatically at COMMIT or ROLLBACK, so no path can leak it.
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended('topic-candidate:' || lower(btrim($1)), 0))`,
    [candidate.name],
  );

  const matches: Match[] = [];

  // Qdrant hits, CONFIRMED against Postgres. A vector whose row is gone is the
  // orphan case - linking to it would report a cache hit that resolves to
  // nothing, which is the dangerous direction of the dual write (§4.6).
  const strong = hits.filter((h) => h.score >= deps.threshold);
  const scored = new Set<string>();
  if (strong.length > 0) {
    const { rows } = await client.query<TopicRow>(
      `SELECT id, name, description, status, created_at FROM topic WHERE id = ANY($1::uuid[])`,
      [strong.map((h) => h.topicId)],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const hit of strong) {
      const topic = byId.get(hit.topicId);
      if (topic) {
        matches.push({ topic, score: hit.score });
        scored.add(topic.id);
      }
    }
  }

  // Same-name topics Qdrant could not score: a vector still owed by the outbox,
  // dead-lettered, or a row seeded without one. This is what closes the race.
  const { rows: sameName } = await client.query<TopicRow>(
    `SELECT id, name, description, status, created_at FROM topic WHERE name_norm = lower(btrim($1))`,
    [candidate.name],
  );
  const unscored = sameName.filter((t) => !scored.has(t.id));
  if (unscored.length > 0) {
    const vectors = await deps.embed(unscored.map((t) => topicEmbeddingText(t.name, t.description)));
    unscored.forEach((topic, i) => {
      const v = vectors[i];
      if (!v) return;
      const score = cosine(vector, v);
      if (score >= deps.threshold) matches.push({ topic, score });
    });
  }

  await deps.beforeDecide?.();

  const best = chooseMatch(matches);
  if (best) return linkExisting(client, fieldId, best);
  return createPending(client, fieldId, candidate);
}

/**
 * Deterministic, because 5.5 depends on it. The index can hold exact duplicates
 * (identical text, identical vector, identical score). If two requests broke that
 * tie differently, two fields would link DIFFERENT rows for one topic and serve
 * different cards - the reuse claim failing while every individual lookup looked
 * correct. So: best score, then a topic that already has cards, then the oldest,
 * then the id.
 */
export function chooseMatch(matches: Match[]): Match | null {
  if (matches.length === 0) return null;
  const rank = { ready: 0, pending: 1, empty: 2 } as const;
  return [...matches].sort((a, b) => {
    if (Math.abs(a.score - b.score) > SCORE_EPSILON) return b.score - a.score;
    if (a.topic.status !== b.topic.status) return rank[a.topic.status] - rank[b.topic.status];
    const t = a.topic.created_at.getTime() - b.topic.created_at.getTime();
    if (t !== 0) return t;
    return a.topic.id < b.topic.id ? -1 : a.topic.id > b.topic.id ? 1 : 0;
  })[0]!;
}

async function linkExisting(client: PoolClient, fieldId: string, match: Match): Promise<Resolution> {
  // Idempotent by primary key: re-proposing a topic can never duplicate a link
  // (invariant 2).
  await client.query(
    `INSERT INTO field_topic (field_id, topic_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [fieldId, match.topic.id],
  );

  if (match.topic.status === "empty") {
    // A candidate proposal IS the sanctioned retry event for an empty topic - and
    // the only one besides "more topics" (invariant 6, P16). This function must
    // therefore never be reachable from paging or polling, or no-retry becomes
    // retry-on-every-poll. The status guard makes a concurrent requeue a no-op.
    await client.query(
      `UPDATE topic SET status = 'pending', claimed_at = NULL WHERE id = $1 AND status = 'empty'`,
      [match.topic.id],
    );
    return { outcome: "requeued", topicId: match.topic.id, score: match.score };
  }

  return {
    outcome: match.topic.status === "ready" ? "reused" : "joined",
    topicId: match.topic.id,
    score: match.score,
  };
}

async function createPending(
  client: PoolClient,
  fieldId: string,
  candidate: Candidate,
): Promise<Resolution> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO topic (name, description) VALUES ($1, $2) RETURNING id`,
    [candidate.name, candidate.description],
  );
  const topicId = rows[0]!.id;

  // Same transaction as the topic: invariant 5 (every topic owes exactly one
  // vector) holds only if the intent to write it commits atomically with the row.
  // The payload shape is a CROSS-SERVICE CONTRACT with the pipeline's outbox
  // worker, which reads exactly these two keys (services/pipeline/app/workers/
  // outbox.py). A test asserts it.
  await client.query(`INSERT INTO outbox (topic_id, payload) VALUES ($1, $2::jsonb)`, [
    topicId,
    JSON.stringify({ name: candidate.name, description: candidate.description }),
  ]);

  await client.query(`INSERT INTO field_topic (field_id, topic_id) VALUES ($1, $2)`, [fieldId, topicId]);

  return { outcome: "created", topicId, score: null };
}
