import { pool } from "../db/pool.js";
import type { FailedTopic, ScrollCard } from "../types.js";

export interface CardRow {
  id: string;
  topic_id: string;
  topic_name: string;
  content: string;
  source_url: string;
  trust_label: "sourced_verified" | "ai_generated";
  why_it_matters: string;
  recall_prompt: string;
  recall_answer: string;
  saved: boolean;
}

/**
 * Shared SELECT list. Every query that reads cards goes through `live_scroll`,
 * never `scroll`: retired cards must not reach a user, and making the safe query
 * the default one is the whole point of the view (invariant 12).
 */
export const cardColumns = `
  s.id, s.content, s.source_url, s.trust_label, s.why_it_matters,
  s.recall_prompt, s.recall_answer,
  t.id AS topic_id, t.name AS topic_name`;

export function rowToCard(row: CardRow): ScrollCard {
  return {
    id: row.id,
    topic: { id: row.topic_id, name: row.topic_name },
    content: row.content,
    source_url: row.source_url,
    trust_label: row.trust_label,
    why_it_matters: row.why_it_matters,
    recall: { prompt: row.recall_prompt, answer: row.recall_answer },
    saved: row.saved,
  };
}

/**
 * The next page: cards in this field that this user has NOT viewed. There is no
 * cursor — the view log is the position — so a field gaining topics mid-session
 * cannot invalidate a place that does not exist.
 */
export async function unviewedPage(
  fieldId: string,
  accountId: string,
  limit: number,
): Promise<ScrollCard[]> {
  const { rows } = await pool.query<CardRow>(
    `SELECT ${cardColumns},
            EXISTS (SELECT 1 FROM saved_scroll ss
                    WHERE ss.account_id = $2 AND ss.scroll_id = s.id) AS saved
     FROM live_scroll s
     JOIN topic t ON t.id = s.topic_id
     JOIN field_topic ft ON ft.topic_id = t.id
     WHERE ft.field_id = $1
       AND t.status = 'ready'
       AND NOT EXISTS (SELECT 1 FROM user_view uv
                       WHERE uv.user_id = $2 AND uv.scroll_id = s.id)
     ORDER BY t.created_at, s.created_at, s.id
     LIMIT $3`,
    [fieldId, accountId, limit],
  );
  return rows.map(rowToCard);
}

/** Revision mode: cards already seen, the longest-ago first. */
export async function revisionPage(
  fieldId: string,
  accountId: string,
  limit: number,
): Promise<ScrollCard[]> {
  const { rows } = await pool.query<CardRow>(
    `SELECT ${cardColumns},
            EXISTS (SELECT 1 FROM saved_scroll ss
                    WHERE ss.account_id = $2 AND ss.scroll_id = s.id) AS saved
     FROM live_scroll s
     JOIN topic t ON t.id = s.topic_id
     JOIN field_topic ft ON ft.topic_id = t.id
     JOIN (SELECT scroll_id, max(viewed_at) AS last_viewed
           FROM user_view WHERE user_id = $2 GROUP BY scroll_id) v ON v.scroll_id = s.id
     WHERE ft.field_id = $1
     ORDER BY v.last_viewed ASC, s.id
     LIMIT $3`,
    [fieldId, accountId, limit],
  );
  return rows.map(rowToCard);
}

/** Topics still being generated for this field. Drives `generating`. */
export async function pendingTopicCount(fieldId: string): Promise<number> {
  const { rows } = await pool.query<{ pending: number }>(
    `SELECT count(*)::int AS pending
     FROM field_topic ft JOIN topic t ON t.id = ft.topic_id
     WHERE ft.field_id = $1 AND t.status = 'pending'`,
    [fieldId],
  );
  return rows[0]?.pending ?? 0;
}

/**
 * Topics whose whole run produced nothing that passed fact-check. Reported to
 * the user rather than silently omitted; retried only by a generation event,
 * never by paging or polling (P16).
 */
export async function failedTopics(fieldId: string): Promise<FailedTopic[]> {
  const { rows } = await pool.query<FailedTopic>(
    `SELECT t.id, t.name
     FROM field_topic ft JOIN topic t ON t.id = ft.topic_id
     WHERE ft.field_id = $1 AND t.status = 'empty'
     ORDER BY t.name`,
    [fieldId],
  );
  return rows;
}

/**
 * How far through the field this user is: of the cards a feed could serve (live,
 * ready topic - the same population as `unviewedPage`), how many they have seen.
 * Counted over that one population so `viewed` can never exceed `total`; a
 * retired card someone saw leaves both.
 */
export async function fieldProgress(
  fieldId: string,
  accountId: string,
): Promise<{ viewed: number; total: number }> {
  const { rows } = await pool.query<{ viewed: number; total: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM user_view uv
                                           WHERE uv.user_id = $2 AND uv.scroll_id = s.id))::int AS viewed
     FROM live_scroll s
     JOIN topic t ON t.id = s.topic_id
     JOIN field_topic ft ON ft.topic_id = t.id
     WHERE ft.field_id = $1 AND t.status = 'ready'`,
    [fieldId, accountId],
  );
  return rows[0] ?? { viewed: 0, total: 0 };
}

/** Distinct cards this user has seen in this field, for the end-of-field card. */
export async function viewedCountInField(fieldId: string, accountId: string): Promise<number> {
  const { rows } = await pool.query<{ seen: number }>(
    `SELECT count(DISTINCT uv.scroll_id)::int AS seen
     FROM user_view uv
     JOIN scroll s ON s.id = uv.scroll_id
     JOIN field_topic ft ON ft.topic_id = s.topic_id
     WHERE ft.field_id = $1 AND uv.user_id = $2`,
    [fieldId, accountId],
  );
  return rows[0]?.seen ?? 0;
}
