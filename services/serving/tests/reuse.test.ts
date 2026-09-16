/**
 * Task 5.5 — THE REUSE PROOF. The acceptance test for the whole design.
 *
 *   Request field A; request overlapping field B; assert pipeline invocations for
 *   the shared topic = 0, exactly one new Field_Topic row, and identical scroll
 *   IDs served under both.   (IMPLEMENTATION-PLAN §9)
 *
 * Everything upstream exists to make this assertion pass, so it runs through the
 * real surface: HTTP feed requests, the real expansion queue and worker, the real
 * resolver and its lock, real Postgres. Two things are stood in for, because CI
 * has neither and neither is where the claim lives:
 *
 *   - the LLM and Qdrant, via tests/fakes.ts (identical text -> identical vector)
 *   - the Python pipeline, via `runPipeline` below, which does what the topic
 *     worker and outbox do - claim pending topics, write cards, mark them ready,
 *     index the vector - and COUNTS generations per topic. That count is
 *     "pipeline invocations", made literal.
 *
 * What this proves is the MECHANISM: a topic both fields propose is generated
 * once and served twice. It does not measure how often real candidates match -
 * the fake gives identical descriptions identical vectors, and real paraphrases
 * score lower (P36). That rate is W5's separate measurement, on a clean database.
 */
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { expandOnce, type ExpansionDeps } from "../src/expansion/worker.js";
import type { Candidate } from "../src/topics/candidates.js";
import { fakeResolveDeps, indexTopic } from "./fakes.js";
import { client, countRows, reseed, startServer, stopServer } from "./helpers.js";

let server: Server;
let base: string;

beforeAll(async () => {
  ({ server, base } = await startServer());
});

afterAll(async () => {
  await stopServer(server);
  await pool.end();
});

beforeEach(async () => {
  await reseed();
});

const FIELD_A = "Sorted Collections";
const FIELD_B = "Java Maps";

// Proposed by BOTH fields, with the same one-liner, so it must be generated once.
const TREEMAP: Candidate = { name: "TreeMap", description: "A sorted map backed by a red-black tree." };
const TREESET: Candidate = { name: "TreeSet", description: "A sorted set backed by a red-black tree." };
const WEAKHASHMAP: Candidate = {
  name: "WeakHashMap",
  description: "A map whose keys may be reclaimed by the garbage collector.",
};

/** A stand-in for the pipeline's topic worker plus its outbox drain. */
function fakePipeline(index: Map<string, number[]>) {
  const generations = new Map<string, number>();

  async function run(): Promise<void> {
    const { rows } = await pool.query<{ id: string; name: string; description: string }>(
      `UPDATE topic SET claimed_at = now()
       WHERE status = 'pending' AND claimed_at IS NULL
       RETURNING id, name, description`,
    );
    for (const topic of rows) {
      generations.set(topic.id, (generations.get(topic.id) ?? 0) + 1);
      for (let i = 1; i <= 2; i++) {
        await pool.query(
          `INSERT INTO scroll (topic_id, content, source_url, trust_label,
                               why_it_matters, recall_prompt, recall_answer)
           VALUES ($1, $2, 'https://example.org', 'sourced_verified', 'w', 'p', 'a')`,
          [topic.id, `${topic.name} card ${i}`],
        );
      }
      await pool.query(`UPDATE topic SET status = 'ready' WHERE id = $1`, [topic.id]);
      await pool.query(
        `INSERT INTO topic_generation_stats (topic_id, drafts_generated, drafts_passed, drafts_failed, runs, run_at)
         VALUES ($1, 2, 2, 0, 1, now())
         ON CONFLICT (topic_id) DO UPDATE SET runs = topic_generation_stats.runs + 1, run_at = now()`,
        [topic.id],
      );
    }
    // The outbox drain: owed vectors become searchable.
    const { rows: owed } = await pool.query<{ topic_id: string; payload: { name: string; description: string } }>(
      `UPDATE outbox SET status = 'done', processed_at = now() WHERE status = 'pending'
       RETURNING topic_id, payload`,
    );
    for (const o of owed) indexTopic(index, o.topic_id, o.payload.name, o.payload.description);
  }

  return { run, generations };
}

function expansionDeps(
  resolve: ExpansionDeps["resolve"],
  byField: Record<string, Candidate[]>,
): ExpansionDeps {
  return {
    generate: async (field) => {
      const candidates = byField[field];
      if (!candidates) throw new Error(`test proposed no candidates for field ${field}`);
      return candidates;
    },
    resolve,
    maxAttempts: 3,
    baseBackoffMs: 60_000,
    staleMs: 600_000,
  };
}

async function topicId(name: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM topic WHERE name = $1`, [name]);
  expect(rows, `expected exactly one ${name} topic`).toHaveLength(1);
  return rows[0]!.id;
}

describe("task 5.5: the reuse proof", () => {
  it("serves a topic proposed by two fields from ONE generation, under both", async () => {
    const { deps: resolve, index } = fakeResolveDeps();
    const pipeline = fakePipeline(index);
    const deps = expansionDeps(resolve, {
      [FIELD_A]: [TREEMAP, TREESET],
      [FIELD_B]: [TREEMAP, WEAKHASHMAP],
    });
    const api = client(base, "reuse-prover");

    // ---- Field A: nothing exists yet, so everything is generated.
    expect((await api.feed(FIELD_A)).body.generating).toBe(true);
    expect((await expandOnce(deps)).kind).toBe("done");
    await pipeline.run();

    const treeMap = await topicId("TreeMap");
    expect(pipeline.generations.get(treeMap)).toBe(1);
    const linksBefore = await countRows(`SELECT count(*) AS n FROM field_topic WHERE topic_id = $1`, [treeMap]);
    expect(linksBefore).toBe(1);

    const underA = (await api.feed(FIELD_A, 30)).body.scrolls
      .filter((s) => s.topic.name === "TreeMap")
      .map((s) => s.id)
      .sort();
    expect(underA).toHaveLength(2);

    // ---- Field B: overlaps field A on TreeMap.
    expect((await api.feed(FIELD_B)).body.generating).toBe(true);
    const expansionB = await expandOnce(deps);
    expect(expansionB.kind).toBe("done");
    if (expansionB.kind === "done") {
      expect(expansionB.counts).toMatchObject({ reused: 1, created: 1 });
    }
    await pipeline.run();

    // 1. Pipeline invocations for the shared topic: ZERO more than field A caused.
    //    Counted across EVERY TreeMap row, not just the original id. The first
    //    version counted the original id alone - and with reuse deliberately
    //    broken it still passed, because broken reuse does not regenerate that
    //    row: it creates a SECOND TreeMap and generates that one. The assertion
    //    was watching the wrong row, and only a later line happened to fail.
    const { rows: allTreeMaps } = await pool.query<{ id: string }>(
      `SELECT id FROM topic WHERE name_norm = 'treemap'`,
    );
    const treeMapGenerations = allTreeMaps.reduce(
      (sum, t) => sum + (pipeline.generations.get(t.id) ?? 0),
      0,
    );
    expect(treeMapGenerations).toBe(1);
    expect(
      await countRows(
        `SELECT coalesce(sum(s.runs), 0) AS n FROM topic_generation_stats s
         JOIN topic t ON t.id = s.topic_id WHERE t.name_norm = 'treemap'`,
      ),
    ).toBe(1);
    //    ...and still one TreeMap row: the shared topic was not recreated.
    await topicId("TreeMap");

    // 2. Exactly ONE new Field_Topic row for the shared topic.
    expect(
      await countRows(`SELECT count(*) AS n FROM field_topic WHERE topic_id = $1`, [treeMap]),
    ).toBe(linksBefore + 1);

    // 3. Identical scroll IDs served under both fields.
    const underB = (await api.feed(FIELD_B, 30)).body.scrolls
      .filter((s) => s.topic.name === "TreeMap")
      .map((s) => s.id)
      .sort();
    expect(underB).toEqual(underA);

    // The field-B-only topic WAS generated - so the zero above is reuse, not a
    // pipeline that never ran.
    expect(pipeline.generations.get(await topicId("WeakHashMap"))).toBe(1);
  });
});
