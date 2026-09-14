import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { client, countRows, display, reseed, startServer, stopServer } from "./helpers.js";

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

describe("cross-field topic reuse", () => {
  /**
   * The central architectural claim, provable with no AI in the system: a topic
   * is not owned by the field that created it, so two fields serve the SAME
   * cards from ONE topic row.
   */
  it("serves one topic's cards under two fields, from a single topic row", async () => {
    const api = client(base, "alice");

    const utils = await api.feed("Java Utils");
    const collections = await api.feed("Java Collections");

    const utilsHashMap = utils.body.scrolls.filter((s) => s.topic.name === "HashMap").map((s) => s.id);
    const collectionsHashMap = collections.body.scrolls
      .filter((s) => s.topic.name === "HashMap")
      .map((s) => s.id);

    expect(utilsHashMap.length).toBeGreaterThan(0);
    expect(collectionsHashMap).toEqual(utilsHashMap);

    expect(await countRows(`SELECT count(*) AS n FROM topic WHERE name = 'HashMap'`)).toBe(1);
    expect(
      await countRows(`SELECT count(*) AS n FROM field_topic WHERE topic_id = $1`, [ids.topics.hashMap]),
    ).toBe(2);
  });

  it("matches a field name regardless of case and padding", async () => {
    const api = client(base, "alice");
    await api.feed("Java Utils");
    await api.feed("  java utils ");
    expect(await countRows(`SELECT count(*) AS n FROM field WHERE name_norm = 'java utils'`)).toBe(1);
  });
});

describe("what a page may and may not contain", () => {
  it("never serves a retired card", async () => {
    const api = client(base, "alice");
    const page = await api.feed("Java Utils", 30);
    expect(page.body.scrolls.map((s) => s.id)).not.toContain(ids.retiredScrollId);
  });

  it("records no views when a page is fetched", async () => {
    // Prefetch means delivered and seen differ; logging on delivery would
    // permanently corrupt the one dataset that cannot be rebuilt (P12).
    const api = client(base, "alice");
    await api.feed("Java Utils", 30);
    expect(await countRows(`SELECT count(*) AS n FROM user_view`)).toBe(0);
  });

  it("returns at most the requested number of cards", async () => {
    const api = client(base, "alice");
    const page = await api.feed("Java Utils", 2);
    expect(page.body.scrolls).toHaveLength(2);
  });
});

describe("paging by view exclusion", () => {
  it("hands out each card once, then reports the field exhausted", async () => {
    const api = client(base, "alice");
    const seen = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const page = await api.feed("Java Utils", 2);
      if (page.body.scrolls.length === 0) {
        expect(page.body.exhausted).toBe(true);
        break;
      }
      for (const card of page.body.scrolls) {
        expect(seen.has(card.id)).toBe(false); // no repeats across pages
        seen.add(card.id);
      }
      await display(api, page.body);
    }

    // Java Utils: HashMap has 4 cards with 1 retired, plus Optional's 2.
    expect(seen.size).toBe(5);
    const final = await api.feed("Java Utils");
    expect(final.body.exhausted).toBe(true);
    expect(final.body.scrolls).toHaveLength(0);
  });

  it("keeps each user's position separate", async () => {
    const alice = client(base, "alice");
    const bob = client(base, "bob");

    const alicePage = await alice.feed("Java Utils", 2);
    await display(alice, alicePage.body);

    const bobPage = await bob.feed("Java Utils", 2);
    expect(bobPage.body.scrolls.map((s) => s.id)).toEqual(alicePage.body.scrolls.map((s) => s.id));
  });
});

describe("the end of a field", () => {
  it("offers a count and adjacent fields instead of looping", async () => {
    const api = client(base, "alice");
    for (let i = 0; i < 10; i++) {
      const page = await api.feed("Java Utils", 30);
      if (page.body.scrolls.length === 0) break;
      await display(api, page.body);
    }

    const end = await api.feed("Java Utils");
    expect(end.body.exhausted).toBe(true);
    expect(end.body.end_card).not.toBeNull();
    expect(end.body.end_card?.viewed_count).toBe(5);

    const adjacent = end.body.end_card?.adjacent_fields ?? [];
    expect(adjacent.map((f) => f.name)).toContain("Java Collections");
    expect(adjacent.every((f) => f.source === "overlap" && f.has_content)).toBe(true);
    // Shares no topic with Java Utils, so it must not be suggested by overlap.
    expect(adjacent.map((f) => f.name)).not.toContain("Behavioural Economics");
  });
});

describe("a field that is still generating", () => {
  it("reports generating rather than exhausted, and names the failed topics", async () => {
    const api = client(base, "alice");
    const page = await api.feed("Java Streams");

    // One pending topic and one that failed fact-check: no cards yet, but the
    // field is early, not finished.
    expect(page.body.scrolls).toHaveLength(0);
    expect(page.body.generating).toBe(true);
    expect(page.body.topics_pending).toBe(1);
    expect(page.body.exhausted).toBe(false);
    expect(page.body.end_card).toBeNull();
    expect(page.body.retry_after_ms).toBeGreaterThan(0);
    expect(page.body.failed_topics.map((t) => t.name)).toEqual(["Lazy Evaluation"]);
  });

  it("treats a brand-new field with no topics as exhausted, not generating", async () => {
    // Until W5 wires generation in, nothing is queued for an unknown field.
    const api = client(base, "alice");
    const page = await api.feed("Marine Biology");
    expect(page.body.generating).toBe(false);
    expect(page.body.exhausted).toBe(true);
    expect(page.body.end_card?.viewed_count).toBe(0);
  });
});

describe("revision mode", () => {
  it("returns seen cards, longest-ago first, and never says exhausted", async () => {
    const api = client(base, "alice");
    const page = await api.feed("Java Utils", 30);
    const [first, second] = page.body.scrolls;
    expect(first && second).toBeTruthy();

    await api.view([{ scroll_id: first!.id, viewed_at: "2026-01-01T10:00:00Z" }]);
    await api.view([{ scroll_id: second!.id, viewed_at: "2026-01-02T10:00:00Z" }]);

    const revision = await api.revision("Java Utils", 30);
    expect(revision.body.exhausted).toBe(false);
    expect(revision.body.scrolls.map((s) => s.id)).toEqual([first!.id, second!.id]);
  });

  it("excludes retired cards from revision too", async () => {
    const api = client(base, "alice");
    await api.view([{ scroll_id: ids.retiredScrollId }]);
    const revision = await api.revision("Java Utils", 30);
    expect(revision.body.scrolls.map((s) => s.id)).not.toContain(ids.retiredScrollId);
  });
});

describe("authentication", () => {
  it("refuses a request with no token", async () => {
    const res = await fetch(`${base}/v1/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field: "Java Utils" }),
    });
    expect(res.status).toBe(401);
  });
});
