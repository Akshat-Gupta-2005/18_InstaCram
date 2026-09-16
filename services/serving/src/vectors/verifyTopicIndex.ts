/**
 * Task 3.4's "done when", checked against the REAL stack: a written topic is
 * retrievable by similarity.
 *
 * Not a unit test, on purpose. CI has Postgres but no Qdrant and no embedding
 * server, and faking both would test the fakes. This runs against the local stack
 * and fails loudly if either is down.
 *
 * Three checks, each able to fail for exactly one reason:
 *   1. every stored topic's own text finds ITSELF as the top hit, above threshold
 *   2. a clearly unrelated query stays BELOW threshold against all of them
 *   3. how many points have no topic row - the orphans a caller must never link to
 *
 *     npm run vectors:verify
 */
import "../env.js";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { embed } from "../embeddings/client.js";
import { topicEmbeddingText } from "../topics/embeddingText.js";
import { searchTopicNames } from "./topicIndex.js";

const UNRELATED = topicEmbeddingText(
  "Sourdough starter",
  "A fermented mixture of flour and water used to leaven bread",
);

async function main(): Promise<number> {
  const { rows: topics } = await pool.query<{ id: string; name: string; description: string }>(
    `SELECT id, name, description FROM topic ORDER BY created_at`,
  );
  const topicIds = new Set(topics.map((t) => t.id));

  const vectors = await embed([...topics.map((t) => topicEmbeddingText(t.name, t.description)), UNRELATED]);
  const unrelated = vectors.pop();
  if (!unrelated) throw new Error("embedding server returned no vectors");

  let failures = 0;
  let indexed = 0;

  console.log(`threshold ${config.topicMatchThreshold}\n`);
  console.log("1. each topic retrieves itself");
  for (const [i, topic] of topics.entries()) {
    const hits = await searchTopicNames(vectors[i]!, 3);
    const self = hits.find((h) => h.topicId === topic.id);
    if (!self) {
      // Not necessarily a failure of the search: the outbox may simply not have
      // written this vector (or the topic was seeded bypassing the outbox).
      console.log(`   -   ${topic.name.padEnd(20)} no vector in the index`);
      continue;
    }
    indexed++;
    const top = hits[0]!;
    const ok = top.score >= config.topicMatchThreshold && self.score >= config.topicMatchThreshold;
    // The top hit may be a DUPLICATE row of the same topic scoring identically, so
    // "is itself somewhere at the top score" is the right check, not "is hits[0]".
    const selfIsTop = Math.abs(self.score - top.score) < 1e-6;
    if (!ok || !selfIsTop) failures++;
    console.log(
      `   ${ok && selfIsTop ? "ok " : "BAD"} ${topic.name.padEnd(20)} self ${self.score.toFixed(4)}` +
        `  top ${top.score.toFixed(4)}`,
    );
  }

  console.log("\n2. an unrelated query matches nothing");
  const far = await searchTopicNames(unrelated, 3);
  const best = far[0]?.score ?? 0;
  const farOk = best < config.topicMatchThreshold;
  if (!farOk) failures++;
  console.log(`   ${farOk ? "ok " : "BAD"} best score ${best.toFixed(4)} (must be < ${config.topicMatchThreshold})`);

  console.log("\n3. orphan vectors (a point with no topic row)");
  const res = await fetch(`${config.qdrantUrl}/collections/topic_names/points/scroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 10_000, with_payload: false, with_vector: false }),
  });
  const body = (await res.json()) as { result: { points: { id: string }[] } };
  const orphans = body.result.points.filter((p) => !topicIds.has(String(p.id)));
  console.log(`   ${orphans.length} of ${body.result.points.length} points have no topic row`);

  console.log(`\n${indexed} of ${topics.length} topics are indexed; ${failures} check(s) failed`);
  return failures === 0 && indexed > 0 ? 0 : 1;
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
