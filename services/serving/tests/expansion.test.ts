/**
 * The field-expansion worker, against real Postgres, with the LLM and the vector
 * store faked. What is under test is the job lifecycle - claim, resolve, finish,
 * retry, give up, recover - which lives entirely in SQL.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import {
  enqueueInitialExpansion,
  enqueueMoreExpansion,
  requeueFailedTopics,
} from "../src/expansion/queue.js";
import { expandOnce, type ExpansionDeps } from "../src/expansion/worker.js";
import { findOrCreateField } from "../src/repo/fields.js";
import type { Candidate } from "../src/topics/candidates.js";
import { fakeResolveDeps, indexTopic } from "./fakes.js";
import { countRows, reseed } from "./helpers.js";

let ids: Awaited<ReturnType<typeof reseed>>;

beforeEach(async () => {
  ids = await reseed();
});

afterAll(async () => {
  await pool.end();
});

const HASHMAP: Candidate = {
  name: "HashMap",
  description: "Hash-table map storing key-value pairs with average constant-time lookup.",
};
const TREEMAP: Candidate = { name: "TreeMap", description: "A sorted map backed by a red-black tree." };

function deps(overrides: Partial<ExpansionDeps> = {}): ExpansionDeps {
  const { deps: resolve, index } = fakeResolveDeps();
  // The seeded HashMap topic is "in Qdrant", so proposing it is a cache hit.
  indexTopic(index, ids.topics.hashMap, HASHMAP.name, HASHMAP.description);
  return {
    generate: async () => [HASHMAP, TREEMAP],
    resolve,
    maxAttempts: 3,
    baseBackoffMs: 60_000,
    staleMs: 600_000,
    ...overrides,
  };
}

async function newFieldWithExpansion(name = "Marine Biology"): Promise<string> {
  const field = await findOrCreateField(name);
  expect(await enqueueInitialExpansion(field.id)).toBe(true);
  return field.id;
}

async function job(fieldId: string) {
  const { rows } = await pool.query(
    `SELECT status, attempts, last_error, next_attempt_at > now() AS backing_off,
            candidates, reused, joined, requeued, created, resolve_errors
     FROM field_expansion WHERE field_id = $1`,
    [fieldId],
  );
  return rows[0];
}

describe("an expansion that succeeds", () => {
  it("resolves every candidate - reusing what exists, creating what does not - and records how", async () => {
    const fieldId = await newFieldWithExpansion();

    const result = await expandOnce(deps());

    expect(result.kind).toBe("done");
    expect(await job(fieldId)).toMatchObject({
      status: "done",
      candidates: 2,
      reused: 1,
      created: 1,
      joined: 0,
      requeued: 0,
      resolve_errors: 0,
    });
    // The whole reuse claim, in one field: the existing HashMap topic is LINKED,
    // not recreated, and only TreeMap is new.
    expect(await countRows(`SELECT count(*) AS n FROM topic WHERE name = 'HashMap'`)).toBe(1);
    expect(await countRows(`SELECT count(*) AS n FROM field_topic WHERE field_id = $1`, [fieldId])).toBe(2);
  });

  it("returns idle when there is nothing to claim", async () => {
    expect((await expandOnce(deps())).kind).toBe("idle");
  });
});

describe("an expansion that fails", () => {
  it("retries with backoff when candidate generation fails, and is not reclaimed early", async () => {
    const fieldId = await newFieldWithExpansion();
    const failing = deps({
      generate: async () => {
        throw new Error("llm gateway 500");
      },
    });

    const result = await expandOnce(failing);

    expect(result.kind).toBe("retrying");
    expect(await job(fieldId)).toMatchObject({ status: "pending", attempts: 1, backing_off: true });
    expect((await job(fieldId)).last_error).toContain("llm gateway 500");
    // Still owed, so the feed keeps reporting `generating`; but not claimable
    // until the backoff elapses, so a dead gateway is not hammered.
    expect((await expandOnce(failing)).kind).toBe("idle");
  });

  it("gives up after the attempt limit rather than retrying forever", async () => {
    const fieldId = await newFieldWithExpansion();
    await pool.query(`UPDATE field_expansion SET attempts = 2`);
    const failing = deps({
      generate: async () => {
        throw new Error("llm gateway 500");
      },
    });

    expect((await expandOnce(failing)).kind).toBe("failed");
    expect(await job(fieldId)).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("retries the whole expansion when EVERY candidate fails to resolve", async () => {
    // The signature of the embedding server or Qdrant being down - nothing about
    // any particular candidate.
    const fieldId = await newFieldWithExpansion();
    const d = deps();
    d.resolve = {
      ...d.resolve,
      embed: async () => {
        throw new Error("embeddings 503");
      },
    };

    expect((await expandOnce(d)).kind).toBe("retrying");
    expect(await job(fieldId)).toMatchObject({ status: "pending" });
  });

  it("finishes with errors counted when only SOME candidates fail", async () => {
    // Regenerating would cost another 32-54s of LLM time and produce a different
    // candidate list, so one bad candidate must not throw away the good ones.
    const fieldId = await newFieldWithExpansion();
    const d = deps();
    const realEmbed = d.resolve.embed;
    d.resolve = {
      ...d.resolve,
      embed: async (texts) => {
        if (texts.some((t) => t.includes("TreeMap"))) throw new Error("embeddings 503");
        return realEmbed(texts);
      },
    };

    expect((await expandOnce(d)).kind).toBe("done");
    expect(await job(fieldId)).toMatchObject({ status: "done", reused: 1, created: 0, resolve_errors: 1 });
  });
});

describe("a worker that dies", () => {
  it("has its stranded expansion returned to the queue and finished by another", async () => {
    // Without the reaper the row stays 'running' forever, and the field reports
    // `generating` forever: a feed that says "still loading" and never loads.
    const fieldId = await newFieldWithExpansion();
    await pool.query(
      `UPDATE field_expansion SET status = 'running', attempts = 1, claimed_at = now() - interval '1 hour'`,
    );

    const result = await expandOnce(deps({ staleMs: 60_000 }));

    expect(result.kind).toBe("done");
    expect(await job(fieldId)).toMatchObject({ status: "done", attempts: 2 });
  });

  it("does not reap an expansion that is merely slow", async () => {
    await newFieldWithExpansion();
    await pool.query(`UPDATE field_expansion SET status = 'running', attempts = 1, claimed_at = now()`);
    expect((await expandOnce(deps({ staleMs: 600_000 }))).kind).toBe("idle");
  });
});

describe("task 5.6: more topics", () => {
  it("passes the field's existing topic names to the generator as exclusions", async () => {
    // Java Utils is seeded with HashMap and Optional. Without the exclusions the
    // generator re-proposes the field's most obvious topics, which are exactly
    // the ones it already has.
    const seen: string[][] = [];
    expect(await enqueueMoreExpansion(ids.fields.javaUtils)).toBe(true);

    const result = await expandOnce(
      deps({
        generate: async (_field, exclude) => {
          seen.push(exclude);
          return [TREEMAP];
        },
      }),
    );

    expect(result.kind).toBe("done");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(expect.arrayContaining(["HashMap", "Optional"]));
  });

  it("gives an initial expansion no exclusions", async () => {
    await newFieldWithExpansion();
    const seen: string[][] = [];
    await expandOnce(deps({ generate: async (_f, exclude) => (seen.push(exclude), [TREEMAP]) }));
    expect(seen).toEqual([[]]);
  });

  it("refuses to stack a second expansion while one is outstanding", async () => {
    // Repeated taps must not buy repeated 32-54s LLM runs.
    const fieldId = await newFieldWithExpansion();
    expect(await enqueueMoreExpansion(fieldId)).toBe(false);

    await expandOnce(deps());
    expect(await enqueueMoreExpansion(fieldId)).toBe(true);
    expect(await enqueueMoreExpansion(fieldId)).toBe(false);
  });

  it("re-queues the field's empty topics, and no other field's", async () => {
    // Java Streams holds the seeded empty topic "Lazy Evaluation".
    const otherEmpty = await pool.query<{ id: string }>(
      `INSERT INTO topic (name, description, status) VALUES ('Elsewhere', 'x', 'empty') RETURNING id`,
    );
    await pool.query(`UPDATE topic SET claimed_at = now() WHERE id = $1`, [ids.topics.lazyEval]);

    expect(await requeueFailedTopics(ids.fields.javaStreams)).toBe(1);

    const { rows } = await pool.query(`SELECT status, claimed_at FROM topic WHERE id = $1`, [ids.topics.lazyEval]);
    expect(rows[0]).toMatchObject({ status: "pending", claimed_at: null });
    const { rows: other } = await pool.query(`SELECT status FROM topic WHERE id = $1`, [otherEmpty.rows[0]!.id]);
    expect(other[0]).toMatchObject({ status: "empty" });
  });
});

describe("two workers", () => {
  it("never run the same expansion twice", async () => {
    // Forced, not timed (P35): the first worker is held INSIDE its run, after it
    // has claimed the job, while a second worker tries to claim.
    await newFieldWithExpansion();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    let generations = 0;

    const slow = deps({
      generate: async () => {
        generations++;
        // Only the FIRST run blocks. If a regression let the second worker claim
        // the same job, it must come back and fail an assertion - an earlier
        // version blocked every run, so that regression deadlocked on the barrier
        // and surfaced as a 30s timeout that pointed nowhere.
        if (generations === 1) {
          entered();
          await held;
        }
        return [TREEMAP];
      },
    });

    const first = expandOnce(slow);
    await inside;
    const second = await expandOnce(slow);
    release();

    expect(second.kind).toBe("idle");
    expect((await first).kind).toBe("done");
    expect(generations).toBe(1);
  });
});
