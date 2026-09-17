/**
 * Task 5.7: the adjacent-field fallback when topic overlap is thin.
 *
 *   Done when: a field with no shared topics still returns suggestions, flagged
 *   as having no existing content.   (IMPLEMENTATION-PLAN §9)
 *
 * Suggestions are generated in the background and stored (DECISIONS 2026-09-17),
 * so these tests store them directly or drive the worker with a fake suggester;
 * no test calls a model.
 */
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { enqueueInitialExpansion } from "../src/expansion/queue.js";
import { expandOnce, type ExpansionDeps } from "../src/expansion/worker.js";
import { findOrCreateField, storeSuggestions } from "../src/repo/fields.js";
import { cleanSuggestions } from "../src/topics/adjacent.js";
import type { AdjacentField } from "../src/types.js";
import { fakeResolveDeps } from "./fakes.js";
import { client, reseed, startServer, stopServer } from "./helpers.js";

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

async function adjacent(fieldId: string): Promise<AdjacentField[]> {
  const res = await client(base, "alice").raw<{ adjacent_fields: AdjacentField[] }>(
    "GET",
    `/v1/fields/${fieldId}/adjacent`,
  );
  expect(res.status).toBe(200);
  return res.body.adjacent_fields;
}

describe("cleaning the model's list", () => {
  it("keeps real field names, in order", () => {
    expect(cleanSuggestions("Java Streams", ["Lambda Expressions", "Functional Interfaces"])).toEqual([
      "Lambda Expressions",
      "Functional Interfaces",
    ]);
  });

  it("drops the field itself, duplicates, non-strings and sentences", () => {
    const raw = [
      " java streams ",
      "Collectors",
      "collectors",
      42,
      "",
      "A field you might enjoy that covers many interesting aspects of Java",
      "Parallel Streams",
    ];
    expect(cleanSuggestions("Java Streams", raw)).toEqual(["Collectors", "Parallel Streams"]);
  });

  it("offers at most five", () => {
    expect(cleanSuggestions("X", ["a", "b", "c", "d", "e", "f", "g"])).toHaveLength(5);
  });

  it("raises when the model returned no list at all", () => {
    expect(() => cleanSuggestions("X", "Oceanography")).toThrow(/no fields array/);
  });
});

describe("task 5.7: the end card when overlap is thin", () => {
  it("still offers suggestions for a field that shares no topics, flagged as having no content", async () => {
    // The plan's done-when, verbatim.
    const field = await findOrCreateField("Marine Biology");
    await storeSuggestions(field.id, ["Oceanography", "Coral Reef Ecology"]);

    expect(await adjacent(field.id)).toEqual([
      { id: null, name: "Oceanography", shared_topics: 0, source: "suggested", has_content: false },
      { id: null, name: "Coral Reef Ecology", shared_topics: 0, source: "suggested", has_content: false },
    ]);
  });

  it("puts overlap fields first and fills only the free slots with suggestions", async () => {
    // Java Utils shares HashMap with Java Collections: one overlap field, so four
    // of the five slots are free.
    await storeSuggestions(ids.fields.javaUtils, ["Generics", "Records", "Enums", "Annotations", "Reflection"]);

    const offered = await adjacent(ids.fields.javaUtils);
    expect(offered.map((f) => [f.name, f.source])).toEqual([
      ["Java Collections", "overlap"],
      ["Generics", "suggested"],
      ["Records", "suggested"],
      ["Enums", "suggested"],
      ["Annotations", "suggested"],
    ]);
  });

  it("never claims a suggested field has no content when it does", async () => {
    // The model named a field that already exists with cards. It is still a
    // suggestion, but has_content: false would be false, and the client renders
    // the two differently.
    const field = await findOrCreateField("Marine Biology");
    await storeSuggestions(field.id, ["java collections"]);

    const [offered] = await adjacent(field.id);
    expect(offered).toEqual({
      id: ids.fields.javaCollections,
      name: "java collections",
      shared_topics: 0,
      source: "suggested",
      has_content: true,
    });
  });

  it("does not repeat a field overlap already offered, or offer the field itself", async () => {
    await storeSuggestions(ids.fields.javaUtils, ["Java Collections", "Java Utils", "Generics"]);
    const offered = await adjacent(ids.fields.javaUtils);
    expect(offered.map((f) => f.name)).toEqual(["Java Collections", "Generics"]);
  });
});

describe("generating suggestions in the background", () => {
  function deps(suggest: ExpansionDeps["suggest"]): ExpansionDeps {
    return {
      generate: async () => [],
      resolve: fakeResolveDeps().deps,
      suggest,
      maxAttempts: 3,
      baseBackoffMs: 60_000,
      staleMs: 600_000,
    };
  }

  it("stores suggestions after a field's expansion finishes", async () => {
    const field = await findOrCreateField("Marine Biology");
    await enqueueInitialExpansion(field.id);

    expect((await expandOnce(deps(async () => ["Oceanography"]))).kind).toBe("done");

    expect((await adjacent(field.id)).map((f) => f.name)).toEqual(["Oceanography"]);
  });

  it("does not regenerate them once a field has a list, even an empty one", async () => {
    // One model call per field, not one per expansion - and "the model had none"
    // is an answer, not a reason to ask again.
    const field = await findOrCreateField("Marine Biology");
    await storeSuggestions(field.id, []);
    await enqueueInitialExpansion(field.id);
    let calls = 0;

    await expandOnce(deps(async () => (calls++, ["Oceanography"])));
    expect(calls).toBe(0);
  });

  it("never fails the expansion when suggesting fails, and retries on a later one", async () => {
    // Suggestions are optional; the field's topics are not.
    const field = await findOrCreateField("Marine Biology");
    await enqueueInitialExpansion(field.id);

    const result = await expandOnce(
      deps(async () => {
        throw new Error("llm gateway 500");
      }),
    );

    expect(result.kind).toBe("done");
    const { rows } = await pool.query(`SELECT suggestions_at FROM field WHERE id = $1`, [field.id]);
    expect(rows[0]).toMatchObject({ suggestions_at: null });
  });
});
