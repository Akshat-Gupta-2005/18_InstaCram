import { defineConfig } from "vitest/config";

/**
 * Integration tests run against a REAL Postgres, not a mock. The rules that
 * matter here — paging by view exclusion, retired cards never surfacing, erasure
 * — live in SQL and in triggers, so a mocked database would test nothing.
 */
export default defineConfig({
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgres://instacram:instacram@localhost:5432/instacram_test",
      AUTH_MODE: "dev",
    },
    // The suites share one database and reseed it, so they must not overlap.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
