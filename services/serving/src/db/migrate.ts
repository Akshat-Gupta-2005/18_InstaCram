/**
 * Minimal forward-only migration runner.
 *
 * Applies every .sql file in ./migrations in filename order, once each, tracked in
 * schema_migrations. Repeatable: running it twice is a no-op, which is what task 1.3
 * asks for. Deliberately not a migration library — see Docs/DECISIONS.md.
 *
 * Two rules keep it correct:
 *  - Migration files must NOT contain BEGIN/COMMIT. Each file runs in a transaction
 *    together with its schema_migrations row; a COMMIT inside the file would close
 *    that transaction early and let the schema be applied without being recorded,
 *    making every later run fail on objects that already exist.
 *  - Runs are serialised with a Postgres advisory lock, so two runners started at
 *    once (e.g. two Kubernetes replicas) cannot both apply the same file.
 *
 * In the container this runs before the server on every start (see the Dockerfile
 * CMD), and the server only starts if it succeeds. Every failure is logged with a
 * "MIGRATION FAILED" prefix, so a container that refuses to start names its cause
 * on the first line of its logs instead of looking like a broken app.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ClientBase } from "pg";
import { pool } from "./pool.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

// Arbitrary constant naming "an InstaCram migration run" for pg_advisory_lock.
const MIGRATION_LOCK_KEY = 72638190;

/**
 * Applies pending migrations on an already-connected client and returns how many
 * ran. Exported so tests build their schema exactly the way the container does,
 * rather than from a copy that can drift.
 *
 * Throws on failure, naming the file. The caller owns the client and is
 * responsible for closing it.
 */
export async function applyMigrations(client: ClientBase): Promise<number> {
  // A second runner blocks here until the first releases, then finds nothing pending.
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (
        await client.query<{ filename: string }>("SELECT filename FROM schema_migrations")
      ).rows.map((r) => r.filename),
    );

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = await readFile(join(migrationsDir, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`applied ${file}`);
        count++;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        // Name the file in the error itself, so whoever catches this can report
        // which migration broke without needing the log line above.
        throw new Error(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return count;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
  }
}

async function main(): Promise<void> {
  // One session for the whole run: advisory locks belong to the session that took them.
  const client = await pool.connect();
  try {
    const count = await applyMigrations(client);
    console.log(count === 0 ? "no pending migrations" : `${count} migration(s) applied`);
  } finally {
    client.release();
  }
}

// Run only when executed directly (`node dist/db/migrate.js`), never on import,
// so tests can reuse applyMigrations without triggering a migration run.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main()
    .catch((err: unknown) => {
      console.error("MIGRATION FAILED:", err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
