import pg from "pg";
import { applyMigrations } from "../src/db/migrate.js";

const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ?? "postgres://instacram:instacram@localhost:5432/postgres";
const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://instacram:instacram@localhost:5432/instacram_test";

/**
 * Builds the test database from scratch before any suite runs, using the same
 * migration runner the container uses. A hand-written copy of the schema here
 * would drift from the real one, and the drift would be invisible.
 */
export default async function setup(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS instacram_test`);
    await admin.query(`CREATE DATABASE instacram_test`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: TEST_URL });
  await client.connect();
  try {
    const applied = await applyMigrations(client);
    console.log(`test database ready: ${applied} migration(s) applied`);
  } finally {
    await client.end();
  }
}
