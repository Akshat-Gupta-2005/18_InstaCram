/**
 * Why did a candidate reuse a topic, or not? Scores one field's linked topics
 * against every OTHER topic of the same name, with the real model.
 *
 * Written because the first live expansion reused 1 of 3 genuinely overlapping
 * topics, and that result has two explanations needing opposite responses: the
 * strict threshold doing what it was calibrated to do (a duplicate instead of a
 * risked false merge, P4), or the resolver failing to find a match that scored
 * above it. Only the scores tell them apart.
 *
 *     npx tsx src/calibration/explainResolution.ts "Java Data Structures"
 */
import "../env.js";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { cosine, embed } from "../embeddings/client.js";
import { topicEmbeddingText } from "../topics/embeddingText.js";

async function main(): Promise<number> {
  const fieldName = process.argv[2];
  if (!fieldName) {
    console.error('usage: explainResolution.ts "<field name>"');
    return 2;
  }

  const { rows } = await pool.query<{
    id: string;
    name: string;
    description: string;
    created_at: Date;
    field_ids: string[];
  }>(
    `SELECT t.id, t.name, t.description, t.created_at,
            array(SELECT ft2.field_id FROM field_topic ft2 WHERE ft2.topic_id = t.id) AS field_ids
     FROM topic t
     WHERE t.name_norm IN (
       SELECT t2.name_norm FROM field_topic ft JOIN field f ON f.id = ft.field_id
       JOIN topic t2 ON t2.id = ft.topic_id WHERE f.name_norm = lower(btrim($1)))
     ORDER BY t.name_norm, t.created_at`,
    [fieldName],
  );

  const { rows: field } = await pool.query<{ id: string }>(
    `SELECT id FROM field WHERE name_norm = lower(btrim($1))`,
    [fieldName],
  );
  const fieldId = field[0]?.id;

  const vectors = await embed(rows.map((r) => topicEmbeddingText(r.name, r.description)));
  const byName = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const key = r.name.toLowerCase();
    const list = byName.get(key) ?? [];
    list.push(i);
    byName.set(key, list);
  });

  console.log(`threshold ${config.topicMatchThreshold}\n`);
  let above = 0;
  let below = 0;
  for (const idxs of byName.values()) {
    if (idxs.length < 2) continue;
    // The row this field's expansion produced or linked, versus every other row.
    const mine = idxs.find((i) => fieldId && rows[i]!.field_ids.includes(fieldId));
    if (mine === undefined) continue;
    const m = rows[mine]!;
    console.log(`${m.name}  (this field's row: "${m.description}")`);
    for (const i of idxs) {
      if (i === mine) continue;
      const s = cosine(vectors[mine]!, vectors[i]!);
      const verdict = s >= config.topicMatchThreshold ? "ABOVE" : "below";
      if (s >= config.topicMatchThreshold) above++;
      else below++;
      console.log(`   ${verdict} ${s.toFixed(4)}  vs "${rows[i]!.description}"`);
    }
    console.log();
  }
  console.log(`${above} pair(s) above threshold, ${below} below`);
  return 0;
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
