/**
 * Tunables. Page size, prefetch threshold and poll cadence are deliberately
 * config rather than constants: the defaults are placeholders, not measured
 * values (Docs/FEATURES.md open items).
 */
export const config = {
  port: Number(process.env.PORT ?? 3000),

  /** Cards per page. The client asks for the next page when ~3 remain. */
  defaultPageSize: Number(process.env.FEED_PAGE_SIZE ?? 10),
  maxPageSize: 30,

  /**
   * How long the client should wait before asking again while a field is still
   * generating. The server dictates this so the cadence can change without
   * shipping a client (Docs/API-CONTRACT.md §1).
   */
  retryAfterMs: Number(process.env.FEED_RETRY_AFTER_MS ?? 3000),

  /** How many adjacent fields the end-of-field card offers. */
  adjacentFieldLimit: 5,

  /**
   * How a request proves who it is.
   *
   *   "dev"        trusts the bearer token as the identity. The test suite's mode:
   *                it lets a test "log in" by choosing a name. Anyone can be
   *                anyone, so it MUST NOT be used for a running app.
   *   "dev-login"  a developer ID and password from .env are exchanged for a
   *                signed token at POST /v1/auth/login, and every request must
   *                carry a token that verifies. The mode for running the app
   *                before real sign-in exists.
   *   "firebase"   Firebase ID tokens - email/password and Google sign-in.
   *                Not wired yet (task 2b.1); refuses rather than pretending.
   */
  authMode: (process.env.AUTH_MODE ?? "dev") as "dev" | "dev-login" | "firebase",

  /** dev-login only. Both must be set, or login is refused. */
  devLoginId: process.env.DEV_LOGIN_ID ?? "",
  devLoginPassword: process.env.DEV_LOGIN_PASSWORD ?? "",

  /**
   * Signs dev-login tokens. Anyone holding it can mint a token for any identity,
   * so it lives in .env, never in code, and is refused if shorter than 32 chars.
   */
  authTokenSecret: process.env.AUTH_TOKEN_SECRET ?? "",
  authTokenTtlHours: Number(process.env.AUTH_TOKEN_TTL_HOURS ?? 24 * 7),

  /**
   * Browser origins allowed to call the API. The web build of the app is served
   * from its own dev server (port 8082 - 8081, Expo's default, is taken by the
   * embeddings service), so without this every browser request is blocked.
   */
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:8082")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  qdrantUrl: process.env.QDRANT_URL ?? "http://localhost:6333",

  /**
   * Fixed by the chosen embedding model (intfloat/e5-base-v2). A collection's
   * vector size cannot be changed after creation, so a different model means a
   * rebuild, not a config tweak.
   */
  embeddingDimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? 768),

  /**
   * Above this cosine similarity a candidate is treated as an existing topic.
   *
   * Measured, not guessed: the lowest value at which zero false merges occurred
   * across 44 hand-labelled pairs (services/serving/calibration/). At it, 67% of
   * genuinely identical topics still merge; the rest become duplicates, which is
   * the accepted cost of never wrongly merging two different concepts (P4).
   *
   * The margin is thin — the worst observed false positive was 0.9542 — so if
   * bad merges ever show up on real data, this number and the deferred
   * disambiguation stage are the two things to revisit.
   */
  topicMatchThreshold: Number(process.env.TOPIC_MATCH_THRESHOLD ?? 0.955),

  /**
   * The field-expansion worker (W5). On by default in the server; off by setting
   * EXPANSION_WORKER=off, e.g. to run several API replicas with one worker. Tests
   * never start it - they drive `expandOnce` directly with injected dependencies.
   */
  expansionWorker: (process.env.EXPANSION_WORKER ?? "on") !== "off",
  expansionPollMs: Number(process.env.EXPANSION_POLL_MS ?? 2000),
  /**
   * Five attempts from 5s covers 5+10+20+40+80 = ~2.5 minutes - long enough to
   * ride out Ollama being restarted, which is the usual cause and has happened
   * repeatedly in development. After that the expansion fails, and the user's
   * "more topics" tap is the recovery.
   */
  expansionMaxAttempts: Number(process.env.EXPANSION_MAX_ATTEMPTS ?? 5),
  expansionBaseBackoffMs: Number(process.env.EXPANSION_BASE_BACKOFF_MS ?? 5000),
  /**
   * A running expansion older than this is presumed to have lost its worker.
   * Measured candidate generation is 32-54s and ~20 resolves take seconds, so ten
   * minutes is far past any real run while still recovering a dead one promptly.
   */
  expansionStaleMs: Number(process.env.EXPANSION_STALE_MS ?? 600_000),
} as const;
