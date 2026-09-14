import pg from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://instacram:instacram@localhost:5432/instacram";

export const pool = new pg.Pool({ connectionString, max: 10 });

export async function dbHealthy(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
