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
 * Other fields ranked by how many topics they share with this one — a third use
 * of the junction table, costing one query and no model call. Its limit is that
 * it can only suggest fields someone has already requested; the LLM fallback for
 * a thin corpus lands in W5.
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
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    shared_topics: r.shared_topics,
    source: "overlap" as const,
    has_content: true,
  }));
}
