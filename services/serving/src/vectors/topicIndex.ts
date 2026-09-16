/**
 * Task 3.4, the read side: which existing topics is this candidate close to?
 *
 * Serving only SEARCHES this collection. The pipeline's outbox worker is the only
 * writer, keyed by topic id, so a point's id IS the topic id and a hit maps
 * straight back to a row. Writing from here as well would be a second
 * implementation of the vector a topic owns, and two writers of one derived
 * store is how a dual write quietly stops being consistent (P11).
 *
 * What a hit is NOT: proof the topic exists. A vector can outlive its row - that
 * is the orphan case reconciliation deletes, and it is the dangerous direction
 * (§4.6). Callers must confirm a hit against Postgres before linking to it.
 */
import { config } from "../config.js";
import { TOPIC_NAME_COLLECTION } from "./collections.js";

export interface TopicHit {
  topicId: string;
  /** Cosine similarity, on the scale the matching threshold was calibrated on. */
  score: number;
}

export async function searchTopicNames(
  vector: number[],
  limit = 5,
  baseUrl: string = config.qdrantUrl,
): Promise<TopicHit[]> {
  if (vector.length !== config.embeddingDimensions) {
    // Qdrant would reject this too, but with a message about the request rather
    // than about the cause. A wrong-sized vector means the embedding model and the
    // collection disagree, and every score from here on would be meaningless.
    throw new Error(
      `query vector has ${vector.length} dimensions, the topic index expects ` +
        `${config.embeddingDimensions} - the embedding model and the collection disagree`,
    );
  }

  const res = await fetch(`${baseUrl}/collections/${TOPIC_NAME_COLLECTION}/points/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vector, limit, with_payload: false }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`qdrant ${res.status} searching ${TOPIC_NAME_COLLECTION}: ${await res.text()}`);
  }

  const body = (await res.json()) as { result?: { id: string | number; score: number }[] };
  return (body.result ?? []).map((p) => ({ topicId: String(p.id), score: p.score }));
}
