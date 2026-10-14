import { Pool, PoolClient } from "pg";

const g = globalThis as unknown as { __feedbackPool?: Pool };

/**
 * Errors raised while *opening* a connection (nothing was sent to the database yet),
 * e.g. a network blip or Neon waking up. Only these are retried, so a write can never run twice.
 */
export function isConnectError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  const msg = err?.message ?? "";
  return (
    ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH"].includes(err?.code ?? "") ||
    msg.includes("due to connection timeout") ||
    msg.includes("timeout exceeded when trying to connect")
  );
}

async function connectWithRetry(p: Pool): Promise<PoolClient> {
  try {
    return await p.connect();
  } catch (e) {
    if (!isConnectError(e)) throw e;
    await new Promise((r) => setTimeout(r, 500));
    return p.connect(); // one retry
  }
}

export function pool(): Pool {
  if (!g.__feedbackPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    const p = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 8_000, // fail fast on a hanging connect; it is retried once
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    });
    // An idle connection dropped by the network must not crash the server.
    p.on("error", (e) => console.error("db idle connection error:", e.message));
    // pool.query = connect (retried once on connect errors) + query + release.
    p.query = (async (...args: unknown[]) => {
      const client = await connectWithRetry(p);
      try {
        return await (client.query as (...a: unknown[]) => Promise<unknown>)(...args);
      } finally {
        client.release();
      }
    }) as Pool["query"];
    g.__feedbackPool = p;
  }
  return g.__feedbackPool;
}

export async function tx<T>(fn: (q: Pool["query"]) => Promise<T>): Promise<T> {
  const client = await connectWithRetry(pool());
  try {
    await client.query("BEGIN");
    const out = await fn(client.query.bind(client) as Pool["query"]);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
