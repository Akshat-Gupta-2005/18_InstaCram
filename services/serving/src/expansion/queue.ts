/**
 * The field_expansion job table (migration 010). Every SQL statement the
 * expansion worker and the feed use lives here.
 *
 * The claim is FOR UPDATE SKIP LOCKED, the same pattern the pipeline's outbox
 * worker uses, so two serving replicas never run one expansion twice and never
 * block each other waiting to find out.
 */
import { pool } from "../db/pool.js";
import type { LastExpansion } from "../types.js";

export interface ExpansionJob {
  id: string;
  fieldId: string;
  fieldName: string;
  kind: "initial" | "more";
  attempts: number;
}

export interface ExpansionCounts {
  candidates: number;
  reused: number;
  joined: number;
  requeued: number;
  created: number;
  resolveErrors: number;
  /** Existing topics (reused or joined) that this run newly linked to the field. */
  linkedExisting: number;
}

/**
 * Called on every feed request, and safe to be. Two guards make a poll a no-op:
 * a field with ANY linked topic is never auto-expanded (it already has content,
 * or was seeded), and a field gets at most one initial expansion, enforced by a
 * unique partial index rather than by this query - so two first requests racing
 * each other still produce one row.
 *
 * Returns true only when this call created the job.
 */
export async function enqueueInitialExpansion(fieldId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO field_expansion (field_id, kind)
     SELECT $1, 'initial'
     WHERE NOT EXISTS (SELECT 1 FROM field_topic WHERE field_id = $1)
     ON CONFLICT DO NOTHING`,
    [fieldId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The user's "more topics" tap (task 5.6). Returns whether THIS call queued the
 * expansion; false means one is already outstanding for the field - the initial
 * one still running, or an earlier tap - and the unique partial index refused a
 * second. Stacking taps would buy nothing but repeated 32-54s LLM calls.
 */
export async function enqueueMoreExpansion(fieldId: string, failedRetried = 0): Promise<boolean> {
  // failed_retried is recorded on the job so the feed can report the tap's whole
  // effect in one place once the expansion finishes.
  const { rowCount } = await pool.query(
    `INSERT INTO field_expansion (field_id, kind, failed_retried) VALUES ($1, 'more', $2)
     ON CONFLICT DO NOTHING`,
    [fieldId, failedRetried],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The field's most recent expansion, for the feed. This is where a "more topics"
 * tap's result arrives, since the tap itself returns before candidates exist.
 * Counts are 0 while it is still running - they are not yet known.
 */
export async function latestExpansion(fieldId: string): Promise<LastExpansion | null> {
  const { rows } = await pool.query<{
    kind: "initial" | "more";
    status: "pending" | "running" | "done" | "failed";
    created: number | null;
    requeued: number | null;
    linked_existing: number | null;
    failed_retried: number | null;
  }>(
    `SELECT kind, status, created, requeued, linked_existing, failed_retried
     FROM field_expansion WHERE field_id = $1
     ORDER BY requested_at DESC, id DESC LIMIT 1`,
    [fieldId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    kind: row.kind,
    // A pending row is still owed; the client need not distinguish queued from
    // running, only "not finished yet".
    status: row.status === "pending" || row.status === "running" ? "running" : row.status,
    topics_queued: (row.created ?? 0) + (row.requeued ?? 0),
    topics_linked: row.linked_existing ?? 0,
    failed_retried: row.failed_retried ?? 0,
  };
}

/**
 * Sends the field's empty topics back to the pipeline. Without this, "more
 * topics" could never retry them: the generator is told to exclude names already
 * linked to the field, so it will not propose them again, and a proposal is the
 * only other retry event (P17, invariant 6).
 *
 * Only ever reached from the user's tap - never from paging or polling (P16).
 */
export async function requeueFailedTopics(fieldId: string): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE topic SET status = 'pending', claimed_at = NULL
     WHERE status = 'empty'
       AND id IN (SELECT topic_id FROM field_topic WHERE field_id = $1)`,
    [fieldId],
  );
  return rowCount ?? 0;
}

/** Topic names already linked to a field: the exclusions for a 'more' expansion. */
export async function linkedTopicNames(fieldId: string): Promise<string[]> {
  const { rows } = await pool.query<{ name: string }>(
    `SELECT t.name FROM field_topic ft JOIN topic t ON t.id = ft.topic_id
     WHERE ft.field_id = $1 ORDER BY t.name`,
    [fieldId],
  );
  return rows.map((r) => r.name);
}

/**
 * An expansion still owed counts as generating. A pending row whose backoff has
 * not elapsed is still owed: it will run, just not yet.
 */
export async function openExpansionExists(fieldId: string): Promise<boolean> {
  const { rows } = await pool.query<{ open: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM field_expansion
                    WHERE field_id = $1 AND status IN ('pending', 'running')) AS open`,
    [fieldId],
  );
  return rows[0]?.open ?? false;
}

export async function claimExpansion(): Promise<ExpansionJob | null> {
  const { rows } = await pool.query<{
    id: string;
    field_id: string;
    field_name: string;
    kind: "initial" | "more";
    attempts: number;
  }>(
    `UPDATE field_expansion fe
     SET status = 'running', claimed_at = now(), attempts = fe.attempts + 1
     FROM field f
     WHERE fe.id = (SELECT id FROM field_expansion
                    WHERE status = 'pending' AND next_attempt_at <= now()
                    ORDER BY next_attempt_at, id
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1)
       AND f.id = fe.field_id
     RETURNING fe.id, fe.field_id, f.name AS field_name, fe.kind, fe.attempts`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    fieldId: row.field_id,
    fieldName: row.field_name,
    kind: row.kind,
    attempts: row.attempts,
  };
}

/**
 * A worker that dies mid-expansion leaves its row 'running' forever, and
 * `generating` true forever with it - a field that says "still loading" and never
 * finishes. Anything running longer than any real expansion takes is returned to
 * the queue. The attempt it was on still counts, so a job that kills its worker
 * every time cannot loop without limit.
 */
export async function reapStaleExpansions(staleMs: number): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE field_expansion
     SET status = 'pending', claimed_at = NULL, next_attempt_at = now()
     WHERE status = 'running' AND claimed_at < now() - ($1 || ' milliseconds')::interval`,
    [String(staleMs)],
  );
  return rowCount ?? 0;
}

export async function completeExpansion(id: string, counts: ExpansionCounts): Promise<void> {
  await pool.query(
    `UPDATE field_expansion
     SET status = 'done', finished_at = now(), last_error = NULL,
         candidates = $2, reused = $3, joined = $4, requeued = $5, created = $6, resolve_errors = $7,
         linked_existing = $8
     WHERE id = $1`,
    [
      id,
      counts.candidates,
      counts.reused,
      counts.joined,
      counts.requeued,
      counts.created,
      counts.resolveErrors,
      counts.linkedExisting,
    ],
  );
}

/**
 * Bounded retry, then failed - the policy the outbox already uses. The usual cause
 * is the LLM gateway or Ollama being down, which is transient and has happened
 * several times in development; a failed expansion is recoverable by the user's
 * "more topics" tap, so giving up after a few minutes loses nothing permanent.
 */
export async function failExpansion(
  job: ExpansionJob,
  error: string,
  maxAttempts: number,
  baseBackoffMs: number,
): Promise<"retrying" | "failed"> {
  if (job.attempts >= maxAttempts) {
    await pool.query(
      `UPDATE field_expansion SET status = 'failed', finished_at = now(), last_error = $2 WHERE id = $1`,
      [job.id, error],
    );
    return "failed";
  }
  const delayMs = baseBackoffMs * 2 ** (job.attempts - 1);
  await pool.query(
    `UPDATE field_expansion
     SET status = 'pending', claimed_at = NULL, last_error = $2,
         next_attempt_at = now() + ($3 || ' milliseconds')::interval
     WHERE id = $1`,
    [job.id, error, String(delayMs)],
  );
  return "retrying";
}
