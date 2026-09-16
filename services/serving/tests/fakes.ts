/**
 * Stand-ins for Qdrant and the embedding server, which CI does not have (P34).
 *
 * The fake embedding is faithful in the one way the lookup depends on: identical
 * text gives an identical vector (similarity 1.0), and different text gives a
 * near-orthogonal one (similarity ~0). That is exactly how exact duplicates and
 * distinct topics behave on the real model. The real search adapter is verified
 * against the real index separately (src/vectors/verifyTopicIndex.ts).
 */
import { cosine } from "../src/embeddings/client.js";
import { pool } from "../src/db/pool.js";
import { topicEmbeddingText } from "../src/topics/embeddingText.js";
import type { ResolveDeps } from "../src/topics/resolve.js";
import type { TopicHit } from "../src/vectors/topicIndex.js";

export const THRESHOLD = 0.955;
const DIM = 64;

/** A deterministic unit vector per string. Same text -> same vector. */
export function fakeVector(text: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const v: number[] = [];
  for (let i = 0; i < DIM; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    v.push(((h >>> 0) / 4294967296) * 2 - 1);
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

/**
 * `index` holds only the vectors the outbox has "written", so a test controls
 * exactly what the search can see - which is how outbox lag is simulated.
 */
export function fakeResolveDeps(index = new Map<string, number[]>()) {
  const deps: ResolveDeps = {
    threshold: THRESHOLD,
    embed: async (texts) => texts.map(fakeVector),
    search: async (vector, limit): Promise<TopicHit[]> =>
      [...index.entries()]
        .map(([topicId, v]) => ({ topicId, score: cosine(vector, v) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit),
  };
  return { deps, index };
}

/** Puts a topic's vector "in Qdrant", as the outbox worker would. */
export function indexTopic(index: Map<string, number[]>, id: string, name: string, description: string) {
  index.set(id, fakeVector(topicEmbeddingText(name, description)));
}

export async function insertTopic(name: string, description: string, status: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO topic (name, description, status) VALUES ($1, $2, $3) RETURNING id`,
    [name, description, status],
  );
  return rows[0]!.id;
}
