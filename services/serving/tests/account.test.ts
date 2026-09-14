import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
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

describe("views", () => {
  it("records one row per displayed card", async () => {
    const api = client(base, "alice");
    const page = await api.feed("Java Utils", 10);
    expect(page.body.scrolls.length).toBeGreaterThanOrEqual(4);

    // Fetch 10, display 4: exactly 4 rows, not 10 (P12).
    const shown = page.body.scrolls.slice(0, 4);
    const res = await api.view(shown.map((s) => ({ scroll_id: s.id })));

    expect(res.status).toBe(202);
    expect(res.body.recorded).toBe(4);
    expect(await countRows(`SELECT count(*) AS n FROM user_view`)).toBe(4);
  });

  it("keeps repeat impressions as separate rows", async () => {
    const api = client(base, "alice");
    const page = await api.feed("Java Utils", 1);
    const card = page.body.scrolls[0]!;

    await api.view([{ scroll_id: card.id }]);
    await api.view([{ scroll_id: card.id }]);

    expect(
      await countRows(`SELECT count(*) AS n FROM user_view WHERE scroll_id = $1`, [card.id]),
    ).toBe(2);
  });

  it("rejects a malformed scroll id", async () => {
    const api = client(base, "alice");
    const res = await api.raw("POST", "/v1/views", { views: [{ scroll_id: "not-a-uuid" }] });
    expect(res.status).toBe(400);
  });
});

describe("saves", () => {
  it("is idempotent and returns newest first", async () => {
    const api = client(base, "alice");
    const page = await api.feed("Java Utils", 3);
    const [a, b] = page.body.scrolls;

    await api.save(a!.id);
    await api.save(b!.id);
    const again = await api.save(a!.id); // saving twice must not duplicate

    expect(again.body.saved_scroll_ids).toHaveLength(2);
    expect(again.body.saved_scroll_ids[0]).toBe(b!.id); // most recent save first

    const saves = await api.saves();
    expect(saves.body.scrolls.map((s) => s.id)).toEqual([b!.id, a!.id]);
  });

  it("marks saved cards in the feed", async () => {
    const api = client(base, "alice");
    const first = await api.feed("Java Utils", 3);
    const card = first.body.scrolls[0]!;
    await api.save(card.id);

    const second = await api.feed("Java Utils", 3);
    expect(second.body.scrolls.find((s) => s.id === card.id)?.saved).toBe(true);
  });

  it("drops a retired card out of the saves list", async () => {
    const api = client(base, "alice");
    await api.save(ids.retiredScrollId); // the save row itself is legitimate
    const saves = await api.saves();
    expect(saves.body.scrolls).toHaveLength(0); // but it reads through live_scroll
  });

  it("removes a save", async () => {
    const api = client(base, "alice");
    const page = await api.feed("Java Utils", 1);
    const card = page.body.scrolls[0]!;
    await api.save(card.id);
    const after = await api.unsave(card.id);
    expect(after.body.saved_scroll_ids).toHaveLength(0);
  });
});

describe("account erasure", () => {
  it("removes the account with its views and saves, and logs counts without an identifier", async () => {
    const alice = client(base, "alice");
    const bob = client(base, "bob");

    const page = await alice.feed("Java Utils", 3);
    await alice.view(page.body.scrolls.map((s) => ({ scroll_id: s.id })));
    await alice.save(page.body.scrolls[0]!.id);

    const bobPage = await bob.feed("Java Utils", 2);
    await bob.view(bobPage.body.scrolls.map((s) => ({ scroll_id: s.id })));

    const res = await alice.eraseAccount();
    expect(res.status).toBe(204);

    expect(await countRows(`SELECT count(*) AS n FROM account WHERE firebase_uid = 'alice'`)).toBe(0);
    expect(await countRows(`SELECT count(*) AS n FROM erasure_log`)).toBe(1);
    expect(
      await countRows(
        `SELECT count(*) AS n FROM information_schema.columns
         WHERE table_name = 'erasure_log'
           AND (column_name LIKE '%account%' OR column_name LIKE '%user%' OR column_name LIKE '%email%')`,
      ),
    ).toBe(0);

    // Bob is untouched: an erasure removes one account's history, not everyone's.
    expect(await countRows(`SELECT count(*) AS n FROM account WHERE firebase_uid = 'bob'`)).toBe(1);
    expect(await countRows(`SELECT count(*) AS n FROM user_view`)).toBe(2);
  });

  it("lets an erased user start again with an empty history", async () => {
    const alice = client(base, "alice");
    const page = await alice.feed("Java Utils", 2);
    await alice.view(page.body.scrolls.map((s) => ({ scroll_id: s.id })));
    await alice.eraseAccount();

    // Same token, new account: the feed starts from the beginning.
    const fresh = await alice.feed("Java Utils", 2);
    expect(fresh.body.scrolls.map((s) => s.id)).toEqual(page.body.scrolls.map((s) => s.id));
  });
});
