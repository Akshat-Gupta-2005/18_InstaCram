/**
 * AUTH_MODE=dev-login: a developer ID + password, exchanged for a signed token.
 *
 * The whole point of this mode, compared with "dev", is that the password
 * protects something. So the tests that matter are the refusals: a guessed token,
 * an edited one, an expired one, one signed with another secret, the wrong
 * password. If any of those got through, the login screen would be decoration.
 */
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signToken, verifyToken } from "../src/auth/tokens.js";
import { config } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import { reseed, startServer, stopServer } from "./helpers.js";

const SECRET = "test-secret-that-is-comfortably-longer-than-32-chars";
const OTHER_SECRET = "another-secret-that-is-also-longer-than-32-characters";
const HOUR = 60 * 60 * 1000;

describe("tokens", () => {
  it("round-trips an identity", () => {
    const token = signToken("dev:developer", SECRET, HOUR);
    expect(verifyToken(token, SECRET)?.sub).toBe("dev:developer");
  });

  it("refuses a token whose payload was edited", () => {
    const [v, , sig] = signToken("dev:developer", SECRET, HOUR).split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "dev:admin", exp: Date.now() + HOUR })).toString("base64url");
    expect(verifyToken(`${v}.${forged}.${sig}`, SECRET)).toBeNull();
  });

  it("refuses a token signed with a different secret", () => {
    expect(verifyToken(signToken("dev:developer", OTHER_SECRET, HOUR), SECRET)).toBeNull();
  });

  it("refuses an expired token", () => {
    const token = signToken("dev:developer", SECRET, HOUR, Date.now() - 2 * HOUR);
    expect(verifyToken(token, SECRET)).toBeNull();
  });

  it("refuses anything malformed without throwing", () => {
    for (const junk of ["", "alice", "v1.x", "v1.a.b.c", "v2.eyJ9.sig", "v1.!!!.???"]) {
      expect(verifyToken(junk, SECRET)).toBeNull();
    }
  });

  it("refuses to sign or verify with a short secret", () => {
    expect(() => signToken("dev:developer", "short", HOUR)).toThrow(/at least 32/);
  });
});

describe("dev-login over HTTP", () => {
  let server: Server;
  let base: string;
  const saved = { ...config };

  beforeAll(async () => {
    ({ server, base } = await startServer());
  });

  afterAll(async () => {
    await stopServer(server);
    await pool.end();
  });

  beforeEach(async () => {
    await reseed();
    // config is read per request, so the mode can be switched for these tests
    // and restored after; the rest of the suite runs in "dev".
    Object.assign(config as Record<string, unknown>, {
      authMode: "dev-login",
      devLoginId: "developer",
      devLoginPassword: "correct horse battery staple",
      authTokenSecret: SECRET,
    });
  });

  afterEach(() => {
    Object.assign(config as Record<string, unknown>, saved);
  });

  async function login(id: string, password: string) {
    const res = await fetch(`${base}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password }),
    });
    return { status: res.status, body: (await res.json()) as { token?: string; error?: { code: string } } };
  }

  async function feed(token: string) {
    return fetch(`${base}/v1/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ field: "Java Utils" }),
    });
  }

  it("issues a token for the right ID and password, and the token opens the feed", async () => {
    const res = await login("developer", "correct horse battery staple");
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^v1\./);
    expect((await feed(res.body.token!)).status).toBe(200);
  });

  it("refuses a wrong password, and a wrong ID, with the same message", async () => {
    const badPassword = await login("developer", "wrong");
    const badId = await login("someone", "correct horse battery staple");
    expect(badPassword.status).toBe(401);
    expect(badId.status).toBe(401);
    expect(badPassword.body).toEqual(badId.body);
  });

  it("refuses a request that just names an identity, as dev mode would have accepted", async () => {
    // THE difference from AUTH_MODE=dev. Without this, the password protects nothing.
    const res = await feed("developer");
    expect(res.status).toBe(401);
  });

  it("refuses a token signed with a different secret", async () => {
    expect((await feed(signToken("dev:developer", OTHER_SECRET, HOUR))).status).toBe(401);
  });

  it("refuses to log anyone in when the credentials are not configured", async () => {
    // Reported before the request body is even validated: a server that cannot
    // log anyone in should say so, not complain about the password field. An
    // empty configured password must never match an empty submitted one.
    Object.assign(config as Record<string, unknown>, { devLoginPassword: "" });
    for (const password of ["", "anything"]) {
      const res = await login("developer", password);
      expect(res.status).toBe(501);
      expect(res.body.error?.code).toBe("login_not_available");
    }
  });
});

describe("CORS", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    ({ server, base } = await startServer());
  });

  afterAll(async () => {
    await stopServer(server);
  });

  it("answers a preflight from an allowed origin", async () => {
    const res = await fetch(`${base}/v1/feed`, {
      method: "OPTIONS",
      headers: { Origin: config.corsOrigins[0]!, "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(config.corsOrigins[0]);
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("gives no CORS headers to an origin that is not listed", async () => {
    const res = await fetch(`${base}/health`, { headers: { Origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
