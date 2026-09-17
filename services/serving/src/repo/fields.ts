import { pool } from "../db/pool.js";
import { UUID } from "../http.js";
import type { AdjacentField } from "../types.js";

export interface Field {
  id: string;
  name: string;
}

/**
 * Fields dedupe on a normalised name, so "Java Utils" and " java utils " are the
 * same field rather than two (the generated name_norm column plus its unique index).
 */
export async function findOrCreateField(name: string): Promise<Field> {
  const { rows } = await pool.query<Field>(
    `INSERT INTO field (name) VALUES ($1)
     ON CONFLICT (name_norm) DO UPDATE SET name = field.name
     RETURNING id, name`,
    [name.trim()],
  );
  const field = rows[0];
  if (!field) throw new Error("field upsert returned no row");
  return field;
}

export async function getField(id: string): Promise<Field | null> {
  // A malformed id cannot name a field. Without this check Postgres rejects it
  // with a uuid syntax error, which every field route returned as a 500.
  if (!UUID.test(id)) return null;
  const { rows } = await pool.query<Field>(`SELECT id, name FROM field WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * What the end card offers next: fields sharing topics with this one first, then,
 * if that leaves free slots, the model's stored suggestions (task 5.7).
 *
 * Overlap costs one query and no model call, and is the better suggestion - those
 * fields already have content. Its limit is that it can only offer fields someone
 * has already requested, so a field in a thin corner of the corpus gets nothing;
 * the suggestions fill exactly that gap. They are read from storage, generated in
 * the background, never generated here (DECISIONS 2026-09-17).
 */
export async function adjacentFields(fieldId: string, limit: number): Promise<AdjacentField[]> {
  const { rows } = await pool.query<{ id: string; name: string; shared_topics: number }>(
    `SELECT f.id, f.name, count(*)::int AS shared_topics
     FROM field_topic a
     JOIN field_topic b ON b.topic_id = a.topic_id AND b.field_id <> a.field_id
     JOIN field f ON f.id = b.field_id
     WHERE a.field_id = $1
     GROUP BY f.id, f.name
     ORDER BY shared_topics DESC, f.name
     LIMIT $2`,
    [fieldId, limit],
  );
  const overlap: AdjacentField[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    shared_topics: r.shared_topics,
    source: "overlap" as const,
    has_content: true,
  }));

  const free = limit - overlap.length;
  if (free <= 0) return overlap;

  // A suggestion may name a field that already exists - even one with cards. It
  // is still a model suggestion, so `source` stays "suggested", but claiming
  // `has_content: false` for a field that has cards would be simply wrong, so both
  // the id and has_content come from the database, not from the suggestion.
  // Fields already offered by overlap, and the field itself, are skipped.
  const { rows: suggested } = await pool.query<{
    name: string;
    existing_id: string | null;
    has_content: boolean;
  }>(
    `SELECT s.name, f.id AS existing_id,
            EXISTS (SELECT 1 FROM field_topic ft
                    JOIN topic t ON t.id = ft.topic_id AND t.status = 'ready'
                    JOIN live_scroll ls ON ls.topic_id = t.id
                    WHERE ft.field_id = f.id) AS has_content
     FROM field_suggestion s
     LEFT JOIN field f ON f.name_norm = s.name_norm
     WHERE s.field_id = $1
       AND (f.id IS NULL OR (f.id <> $1 AND f.id <> ALL ($2::uuid[])))
     ORDER BY s.position
     LIMIT $3`,
    [fieldId, overlap.map((o) => o.id), free],
  );

  return [
    ...overlap,
    ...suggested.map((s) => ({
      id: s.existing_id,
      name: s.name,
      shared_topics: 0,
      source: "suggested" as const,
      has_content: s.has_content,
    })),
  ];
}

/** Whether suggestions have been generated for a field - "none" and "not yet" differ. */
export async function suggestionsGenerated(fieldId: string): Promise<boolean> {
  const { rows } = await pool.query<{ done: boolean }>(
    `SELECT suggestions_at IS NOT NULL AS done FROM field WHERE id = $1`,
    [fieldId],
  );
  return rows[0]?.done ?? false;
}

/**
 * Replaces a field's stored suggestions and marks them generated, atomically, so
 * the end card never sees half a list.
 */
export async function storeSuggestions(fieldId: string, names: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM field_suggestion WHERE field_id = $1`, [fieldId]);
    for (const [position, name] of names.entries()) {
      await client.query(
        `INSERT INTO field_suggestion (field_id, name, position) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [fieldId, name, position],
      );
    }
    await client.query(`UPDATE field SET suggestions_at = now() WHERE id = $1`, [fieldId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
