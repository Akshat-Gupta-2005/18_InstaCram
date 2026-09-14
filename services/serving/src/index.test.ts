import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { pool } from "./db/pool.js";

/** Smoke test for the health endpoint the container's healthcheck depends on. */
describe("GET /health", () => {
  it("reports ok when the database is reachable", async () => {
    const server = createApp().listen(0);
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = (await res.json()) as { status: string; db: string; service: string };
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ status: "ok", db: "ok", service: "serving" });
    } finally {
      server.close();
      await pool.end();
    }
  });
});
