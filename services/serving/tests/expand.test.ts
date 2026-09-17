/**
 * Task 5.6: POST /v1/fields/{field_id}/expand - the "more topics" action.
 *
 * The tap returns at once; candidate generation happens in the background, so
 * what it achieved arrives in the feed's `last_expansion` (DECISIONS 2026-09-16).
 * The contract's promise that matters most is the exhaustion signal: a finished
 * 'more' expansion reporting 0 queued, 0 linked and 0 retried means the client
 * stops offering the action. Get that wrong in one direction and a finished
 * field offers "more" forever; in the other, a field with more to give stops.
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
let ids: Awaited<ReturnType<typeof reseed>>;

beforeAll(async () => {
  ({ server, base } = await startServer());
});

afterAll(async () => {
  await stopServer(server);
  await pool.end();
});

beforeEach(async () => {
  ids = await reseed();
});

const HASHMAP: Candidate = {
  name: "HashMap",
  description: "Hash-table map storing key-value pairs with average constant-time lookup.",
};
const TREEMAP: Candidate = { name: "TreeMap", description: "A sorted map backed by a red-black tree." };

function deps(candidates: Candidate[]): ExpansionDeps {
  const { deps: resolve, index } = fakeResolveDeps();
  indexTopic(index, ids.topics.hashMap, HASHMAP.name, HASHMAP.description);
  return {
    generate: async () => candidates,
    resolve,
    maxAttempts: 3,
    baseBackoffMs: 60_000,
    staleMs: 600_000,
  };
}

describe("the tap", () => {
  it("returns at once, re-queues the field's failed topics, and queues an expansion", async () => {
    const api = client(base, "alice");
    const res = await api.expand(ids.fields.javaStreams);

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ expansion: "queued", failed_retried: 1 });
    expect(res.body.retry_after_ms).toBeGreaterThan(0);

    const { rows } = await pool.query(`SELECT status FROM topic WHERE id = $1`, [ids.topics.lazyEval]);
    expect(rows[0]).toMatchObject({ status: "pending" });
  });

  it("does not stack a second expansion on repeated taps", async () => {
    const api = client(base, "alice");
    await api.expand(ids.fields.javaUtils);
    const again = await api.expand(ids.fields.javaUtils);

    expect(again.body).toMatchObject({ expansion: "already_running", failed_retried: 0 });
    expect(await countRows(`SELECT count(*) AS n FROM field_expansion`)).toBe(1);
  });

  it("answers 404 for an unknown field, and for an id that is not a uuid", async () => {
    // The malformed case used to reach Postgres as a uuid syntax error and come
    // back as a 500 - on the adjacent-fields route too, which shares the lookup.
    const api = client(base, "alice");
    expect((await api.expand("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await api.expand("not-a-uuid")).status).toBe(404);
    expect((await api.raw("GET", "/v1/fields/not-a-uuid/adjacent")).status).toBe(404);
  });
});

describe("the result, reported through the feed", () => {
  it("shows the expansion running, then what it achieved", async () => {
    const api = client(base, "alice");
    await api.expand(ids.fields.javaCollections);

    const during = await api.feed("Java Collections");
    expect(during.body.last_expansion).toMatchObject({ kind: "more", status: "running" });
    expect(during.body.generating).toBe(true);

    expect((await expandOnce(deps([TREEMAP]))).kind).toBe("done");

    const after = await api.feed("Java Collections");
    expect(after.body.last_expansion).toEqual({
      kind: "more",
      status: "done",
      topics_queued: 1,
      topics_linked: 0,
      failed_retried: 0,
    });
  });

  it("counts a topic another field already generated as linked, not as nothing", async () => {
    // Behavioural Economics does not have HashMap; Java Utils does. Linking it is
    // new content for this field at no pipeline cost, and must not read as
    // "exhausted".
    const api = client(base, "alice");
    await api.expand(ids.fields.behaviouralEconomics);
    await expandOnce(deps([HASHMAP]));

    const page = await api.feed("Behavioural Economics");
    expect(page.body.last_expansion).toMatchObject({
      status: "done",
      topics_queued: 0,
      topics_linked: 1,
    });
  });

  it("reports all zeros when the generator only re-proposes what the field has", async () => {
    // THE exhaustion signal. Java Utils already has HashMap; a generator that
    // ignores its exclusions and proposes it again adds nothing. Counting that
    // no-op link as progress would offer "more topics" forever.
    const api = client(base, "alice");
    await api.expand(ids.fields.javaUtils);
    await expandOnce(deps([HASHMAP]));

    const page = await api.feed("Java Utils");
    expect(page.body.last_expansion).toEqual({
      kind: "more",
      status: "done",
      topics_queued: 0,
      topics_linked: 0,
      failed_retried: 0,
    });
  });
});
