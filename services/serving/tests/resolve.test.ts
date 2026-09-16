/**
 * The branch cache-then-generate is named for, against REAL Postgres.
 *
 * Qdrant and the embedding server are replaced by a small in-memory index,
 * because CI has neither (P34) - and because the rules that matter here live in
 * SQL: the advisory lock, the same-name read, the outbox row, the requeue. The
 * real search adapter is verified against the real index separately
 * (src/vectors/verifyTopicIndex.ts).
 *
 * The fake embedding is deliberately faithful in the one way that matters:
 * identical text gives an identical vector (similarity 1.0), and different text
 * gives a near-orthogonal one (similarity ~0). That is exactly how exact
 * duplicates and distinct topics behave on the real model.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { chooseMatch, resolveCandidate, type ResolveDeps } from "../src/topics/resolve.js";
import { topicEmbeddingText } from "../src/topics/embeddingText.js";
import { cosine } from "../src/embeddings/client.js";
import type { TopicHit } from "../src/vectors/topicIndex.js";
import { countRows, reseed } from "./helpers.js";

const THRESHOLD = 0.955;
const DIM = 64;

let ids: Awaited<ReturnType<typeof reseed>>;

beforeEach(async () => {
  ids = await reseed();
});

afterAll(async () => {
  await pool.end();
});

/** A deterministic unit vector per string. Same text -> same vector. */
function fakeVector(text: string): number[] {
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
 * Stands in for Qdrant. `index` holds only the vectors the outbox has "written",
 * so a test controls exactly what the search can see - which is how outbox lag
 * is simulated.
 */
function fakeDeps(index = new Map<string, number[]>(), searchDelayMs = 0) {
  const calls = { embed: 0, search: 0 };
  const deps: ResolveDeps = {
    threshold: THRESHOLD,
    embed: async (texts) => {
      calls.embed++;
      return texts.map(fakeVector);
    },
    search: async (vector, limit): Promise<TopicHit[]> => {
      calls.search++;
      if (searchDelayMs) await new Promise((r) => setTimeout(r, searchDelayMs));
      return [...index.entries()]
        .map(([topicId, v]) => ({ topicId, score: cosine(vector, v) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
  };
  return { deps, index, calls };
}

async function insertTopic(name: string, description: string, status: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO topic (name, description, status) VALUES ($1, $2, $3) RETURNING id`,
    [name, description, status],
  );
  return rows[0]!.id;
}

/** Puts a topic's vector "in Qdrant", as the outbox worker would. */
function indexTopic(index: Map<string, number[]>, id: string, name: string, description: string) {
  index.set(id, fakeVector(topicEmbeddingText(name, description)));
}

const TREEMAP = { name: "TreeMap", description: "A sorted map backed by a red-black tree." };

describe("a miss", () => {
  it("creates one pending topic, owes its vector, and links it to the field", async () => {
    const { deps } = fakeDeps();
    const r = await resolveCandidate(ids.fields.javaCollections, TREEMAP, deps);

    expect(r.outcome).toBe("created");
    const { rows } = await pool.query(`SELECT status, claimed_at FROM topic WHERE id = $1`, [r.topicId]);
    expect(rows[0]).toMatchObject({ status: "pending", claimed_at: null });
    expect(await countRows(`SELECT count(*) AS n FROM outbox WHERE topic_id = $1`, [r.topicId])).toBe(1);
    expect(
      await countRows(`SELECT count(*) AS n FROM field_topic WHERE field_id = $1 AND topic_id = $2`, [
        ids.fields.javaCollections,
        r.topicId,
      ]),
    ).toBe(1);
  });

  it("writes the outbox payload the pipeline's worker reads - exactly name and description", async () => {
    // A cross-service contract. The Python worker reads payload["name"] and
    // payload["description"]; a renamed key here would dead-letter every topic
    // serving creates, and the topic would never become searchable.
    const { deps } = fakeDeps();
    const r = await resolveCandidate(ids.fields.javaCollections, TREEMAP, deps);
    const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM outbox WHERE topic_id = $1`,
      [r.topicId],
    );
    expect(rows[0]!.payload).toEqual({ name: TREEMAP.name, description: TREEMAP.description });
  });

  it("treats a match below the threshold as a miss", async () => {
    const { deps, index } = fakeDeps();
    const existing = await insertTopic("Stack", "A last-in first-out collection of elements.", "ready");
    indexTopic(index, existing, "Stack", "A last-in first-out collection of elements.");

    // Same name, different meaning: the fake gives near-zero similarity, as the
    // real model would for "Stack" the data structure vs the technology stack.
    const r = await resolveCandidate(
      ids.fields.javaCollections,
      { name: "Stack", description: "The set of technologies an application is built with." },
      deps,
    );
    expect(r.outcome).toBe("created");
    expect(r.topicId).not.toBe(existing);
    // Polysemy survives: the name lock serialises, it does not merge.
    expect(await countRows(`SELECT count(*) AS n FROM topic WHERE name = 'Stack'`)).toBe(2);
  });

  it("never links to a vector whose topic row is gone", async () => {
    // The orphan case. Linking to it would report a cache hit that resolves to
    // nothing - the dangerous direction of the dual write (§4.6).
    const { deps, index } = fakeDeps();
    const ghost = "00000000-0000-4000-8000-000000000000";
    indexTopic(index, ghost, TREEMAP.name, TREEMAP.description);

    const r = await resolveCandidate(ids.fields.javaCollections, TREEMAP, deps);
    expect(r.outcome).toBe("created");
    expect(r.topicId).not.toBe(ghost);
  });
});

describe("a hit", () => {
  it("reuses a ready topic without creating anything or owing a vector", async () => {
    const { deps, index } = fakeDeps();
    const existing = await insertTopic(TREEMAP.name, TREEMAP.description, "ready");
    indexTopic(index, existing, TREEMAP.name, TREEMAP.description);
    const topicsBefore = await countRows(`SELECT count(*) AS n FROM topic`);

    const r = await resolveCandidate(ids.fields.javaCollections, TREEMAP, deps);

    expect(r).toMatchObject({ outcome: "reused", topicId: existing });
    expect(await countRows(`SELECT count(*) AS n FROM topic`)).toBe(topicsBefore);
    expect(await countRows(`SELECT count(*) AS n FROM outbox WHERE topic_id = $1`, [existing])).toBe(0);
  });

  it("joins a pending topic without queueing it twice", async () => {
    const { deps, index } = fakeDeps();
    const existing = await insertTopic(TREEMAP.name, TREEMAP.description, "pending");
    indexTopic(index, existing, TREEMAP.name, TREEMAP.description);

    const r = await resolveCandidate(ids.fields.javaCollections, TREEMAP, deps);
    expect(r).toMatchObject({ outcome: "joined", topicId: existing });
  });

  it("sends an empty topic back to the queue, clearing any stale claim", async () => {
    const { deps, index } = fakeDeps();
    const existing = await insertTopic(TREEMAP.name, TREEMAP.description, "empty");
    await pool.query(`UPDATE topic SET claimed_at = now() WHERE id = $1`, [existing]);
    indexTopic(index, existing, TREEMAP.name, TREEMAP.description);

    const r = await resolveCandidate(ids.fields.javaCollections, TREEMAP, deps);

    expect(r).toMatchObject({ outcome: "requeued", topicId: existing });
    const { rows } = await pool.query(`SELECT status, claimed_at FROM topic WHERE id = $1`, [existing]);
    expect(rows[0]).toMatchObject({ status: "pending", claimed_at: null });
  });

  it("links a topic to a field once, however many times it is proposed", async () => {
    const { deps, index } = fakeDeps();
    const existing = await insertTopic(TREEMAP.name, TREEMAP.description, "ready");
    indexTopic(index, existing, TREEMAP.name, TREEMAP.description);

    await resolveCandidate(ids.fields.javaCollections, TREEMAP, deps);
    await resolveCandidate(ids.fields.javaCollections, TREEMAP, deps);
    expect(
      await countRows(`SELECT count(*) AS n FROM field_topic WHERE field_id = $1 AND topic_id = $2`, [
        ids.fields.javaCollections,
        existing,
      ]),
    ).toBe(1);
  });
});

describe("a vector the outbox has not written yet", () => {
  it("is still found, through Postgres, so the topic is not created twice", async () => {
    // The index stays EMPTY throughout - the first topic's vector is "owed". Any
    // dedupe here can only have come from the same-name read under the lock.
    const { deps } = fakeDeps();
    const first = await resolveCandidate(ids.fields.javaCollections, TREEMAP, deps);
    const second = await resolveCandidate(ids.fields.javaUtils, TREEMAP, deps);

    expect(first.outcome).toBe("created");
    expect(second).toMatchObject({ outcome: "joined", topicId: first.topicId });
    expect(await countRows(`SELECT count(*) AS n FROM topic WHERE name = 'TreeMap'`)).toBe(1);
  });

  it("survives simultaneous requests: eight at once create exactly one topic", async () => {
    // The race the advisory lock exists for, FORCED rather than hoped for. An
    // earlier version relied on timing and passed with the lock deleted - the
    // transactions were short enough to serialise themselves - so it could not
    // fail and proved nothing.
    //
    // The barrier holds each request after its lookup and before its decision,
    // until all eight have arrived. Unlocked, all eight get there having each
    // read "no such topic", and all eight insert. Locked, only one request can
    // ever be past the lock, so the barrier never fills; each waits out the
    // timeout alone and the next one then sees its committed row.
    const REQUESTS = 8;
    let arrived = 0;
    let releaseAll!: () => void;
    const allArrived = new Promise<void>((r) => (releaseAll = r));
    const { deps } = fakeDeps();
    deps.beforeDecide = async () => {
      arrived++;
      if (arrived >= REQUESTS) releaseAll();
      await Promise.race([allArrived, new Promise((r) => setTimeout(r, 150))]);
    };
    const fields = Object.values(ids.fields);

    const results = await Promise.all(
      Array.from({ length: REQUESTS }, (_, i) =>
        resolveCandidate(fields[i % fields.length]!, TREEMAP, deps),
      ),
    );

    expect(await countRows(`SELECT count(*) AS n FROM topic WHERE name = 'TreeMap'`)).toBe(1);
    expect(results.filter((r) => r.outcome === "created")).toHaveLength(1);
    expect(new Set(results.map((r) => r.topicId)).size).toBe(1);
    expect(await countRows(`SELECT count(*) AS n FROM outbox`)).toBe(1);
  });
});

describe("choosing between duplicates", () => {
  it("picks the same row every time, so two fields cannot link different copies", async () => {
    // Exact duplicates exist in practice - repeated measurement runs left three
    // identical HashMap rows in the dev index. 5.5 asserts both fields serve the
    // SAME scroll ids, which holds only if the tie always breaks the same way.
    const { deps, index } = fakeDeps();
    const older = await insertTopic(TREEMAP.name, TREEMAP.description, "ready");
    await new Promise((r) => setTimeout(r, 20));
    const newer = await insertTopic(TREEMAP.name, TREEMAP.description, "ready");
    // Insert into the index newest-first, so an order-dependent choice would pick it.
    indexTopic(index, newer, TREEMAP.name, TREEMAP.description);
    indexTopic(index, older, TREEMAP.name, TREEMAP.description);

    const a = await resolveCandidate(ids.fields.javaCollections, TREEMAP, deps);
    const b = await resolveCandidate(ids.fields.javaUtils, TREEMAP, deps);
    expect(a.topicId).toBe(older);
    expect(b.topicId).toBe(older);
  });

  it("prefers a topic with cards over an empty duplicate at the same score", () => {
    const at = new Date("2026-01-01");
    const empty = { id: "a", name: "x", description: "x", status: "empty" as const, created_at: at };
    const ready = { id: "b", name: "x", description: "x", status: "ready" as const, created_at: at };
    expect(chooseMatch([{ topic: empty, score: 0.99 }, { topic: ready, score: 0.99 }])?.topic.id).toBe("b");
  });

  it("still prefers a clearly better score over status", () => {
    const at = new Date("2026-01-01");
    const empty = { id: "a", name: "x", description: "x", status: "empty" as const, created_at: at };
    const ready = { id: "b", name: "x", description: "x", status: "ready" as const, created_at: at };
    expect(chooseMatch([{ topic: empty, score: 0.99 }, { topic: ready, score: 0.96 }])?.topic.id).toBe("a");
  });
});
