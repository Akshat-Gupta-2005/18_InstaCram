import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { seed } from "../src/seed.js";
import type { ExpandResponse, FeedPage, ScrollCard } from "../src/types.js";

export async function startServer(): Promise<{ server: Server; base: string }> {
  const server = createApp().listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

export async function stopServer(server: Server): Promise<void> {
  server.close();
  await once(server, "close");
}

/** Wipes and re-inserts the fixtures. Returns the ids the tests assert against. */
export async function reseed(): Promise<Awaited<ReturnType<typeof seed>>> {
  const client = await pool.connect();
  try {
    return await seed(client);
  } finally {
    client.release();
  }
}

/**
 * In dev auth mode the bearer token IS the identity, so a test "logs in" simply
 * by picking a name. Two names are two separate users.
 */
export function client(base: string, token: string) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  async function send<T>(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => null)) as T;
    return { status: res.status, body: parsed };
  }

  return {
    feed: (field: string, limit?: number) =>
      send<FeedPage>("POST", "/v1/feed", limit === undefined ? { field } : { field, limit }),
    revision: (field: string, limit?: number) =>
      send<FeedPage>(
        "POST",
        "/v1/feed/revision",
        limit === undefined ? { field } : { field, limit },
      ),
    view: (views: { scroll_id: string; viewed_at?: string }[]) =>
      send<{ recorded: number }>("POST", "/v1/views", { views }),
    saves: () => send<{ scrolls: ScrollCard[] }>("GET", "/v1/saves"),
    save: (scrollId: string) =>
      send<{ saved_scroll_ids: string[] }>("PUT", `/v1/saves/${scrollId}`),
    unsave: (scrollId: string) =>
      send<{ saved_scroll_ids: string[] }>("DELETE", `/v1/saves/${scrollId}`),
    eraseAccount: () => send<null>("DELETE", "/v1/account"),
    expand: (fieldId: string) => send<ExpandResponse>("POST", `/v1/fields/${fieldId}/expand`),
    raw: send,
  };
}

/** Marks every card in a page as displayed, which is what advances the feed. */
export async function display(
  api: ReturnType<typeof client>,
  page: FeedPage,
  at?: string,
): Promise<void> {
  if (page.scrolls.length === 0) return;
  await api.view(
    page.scrolls.map((s) => (at === undefined ? { scroll_id: s.id } : { scroll_id: s.id, viewed_at: at })),
  );
}

export async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}
