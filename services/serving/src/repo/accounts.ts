import { pool } from "../db/pool.js";
import type { ScrollCard } from "../types.js";
import { cardColumns, rowToCard, type CardRow } from "./feed.js";

export interface Account {
  id: string;
  firebase_uid: string;
  email: string;
}

export async function findOrCreateAccount(firebaseUid: string, email: string): Promise<Account> {
  // The no-op SET is what makes RETURNING fire on an existing row.
  const { rows } = await pool.query<Account>(
    `INSERT INTO account (firebase_uid, email) VALUES ($1, $2)
     ON CONFLICT (firebase_uid) DO UPDATE SET email = account.email
     RETURNING id, firebase_uid, email`,
    [firebaseUid, email],
  );
  const account = rows[0];
  if (!account) throw new Error("account upsert returned no row");
  return account;
}

/**
 * One row per card DISPLAYED. The server never infers an impression from a page
 * it sent: prefetch means delivered and seen differ by up to a page (P12).
 */
export async function recordViews(
  accountId: string,
  views: { scroll_id: string; viewed_at?: string }[],
): Promise<number> {
  if (views.length === 0) return 0;
  const ids = views.map((v) => v.scroll_id);
  const times = views.map((v) => v.viewed_at ?? null);
  const { rowCount } = await pool.query(
    `INSERT INTO user_view (user_id, scroll_id, viewed_at)
     SELECT $1, x.scroll_id, coalesce(x.viewed_at, now())
     FROM unnest($2::uuid[], $3::timestamptz[]) AS x(scroll_id, viewed_at)`,
    [accountId, ids, times],
  );
  return rowCount ?? 0;
}

export async function savedScrollIds(accountId: string): Promise<string[]> {
  const { rows } = await pool.query<{ scroll_id: string }>(
    `SELECT scroll_id FROM saved_scroll WHERE account_id = $1 ORDER BY saved_at DESC`,
    [accountId],
  );
  return rows.map((r) => r.scroll_id);
}

/** Idempotent: saving twice is a no-op, enforced by the table's primary key. */
export async function addSave(accountId: string, scrollId: string): Promise<void> {
  await pool.query(
    `INSERT INTO saved_scroll (account_id, scroll_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [accountId, scrollId],
  );
}

export async function removeSave(accountId: string, scrollId: string): Promise<void> {
  await pool.query(`DELETE FROM saved_scroll WHERE account_id = $1 AND scroll_id = $2`, [
    accountId,
    scrollId,
  ]);
}

/** Reads through live_scroll, so a retired card drops out of the saves list. */
export async function listSaves(accountId: string): Promise<ScrollCard[]> {
  const { rows } = await pool.query<CardRow>(
    `SELECT ${cardColumns}, true AS saved
     FROM saved_scroll ss
     JOIN live_scroll s ON s.id = ss.scroll_id
     JOIN topic t ON t.id = s.topic_id
     WHERE ss.account_id = $1
     ORDER BY ss.saved_at DESC`,
    [accountId],
  );
  return rows.map(rowToCard);
}

/**
 * The only path allowed to remove view history. erase_account() deletes the
 * account, its views and its saves in one transaction and writes an audit row
 * carrying counts but no identifier (invariant 13).
 */
export async function eraseAccount(accountId: string): Promise<void> {
  await pool.query(`SELECT erase_account($1)`, [accountId]);
}
