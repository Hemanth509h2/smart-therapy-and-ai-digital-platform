import { Pool } from "pg";

const g = globalThis as unknown as { __feedbackPool?: Pool };

export function pool(): Pool {
  if (!g.__feedbackPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    // Generous connect timeout: a serverless Postgres (Neon) may need a few seconds to wake up.
    g.__feedbackPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 20_000, idleTimeoutMillis: 30_000, keepAlive: true });
  }
  return g.__feedbackPool;
}

export async function tx<T>(fn: (q: Pool["query"]) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client.query.bind(client) as Pool["query"]);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
