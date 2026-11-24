/**
 * The audit hash chain must stay intact under concurrent writers, using the
 * Postgres advisory lock (ported from engine/test_audit_concurrency.py).
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initSchema, log, verifyAuditChain } from "../../lib/server/db";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5435/feasibility3d";

// getPool() reads DATABASE_URL lazily; ensure it is set before any connect.
process.env.DATABASE_URL = DATABASE_URL;

const THREADS = 20;
const WRITES_PER_THREAD = 5;

const pool = new Pool({ connectionString: DATABASE_URL, max: THREADS + 2 });

beforeAll(async () => {
  await initSchema();
  const client = await pool.connect();
  try {
    await client.query("TRUNCATE audit_log, spills RESTART IDENTITY");
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool.end();
});

describe("audit chain concurrency (Postgres advisory lock)", () => {
  it("keeps the hash chain valid under 20 concurrent writers", async () => {
    await Promise.all(
      Array.from({ length: THREADS }, (_, n) =>
        (async () => {
          const client = await pool.connect();
          try {
            for (let i = 0; i < WRITES_PER_THREAD; i++) {
              await log(client, "SPL-0001", "analysis_rerun_identical", `thread-${n}`, {
                thread: n,
                i,
              });
            }
          } finally {
            client.release();
          }
        })(),
      ),
    );

    const client = await pool.connect();
    try {
      const result = await verifyAuditChain(client);
      expect(result).toEqual({ ok: true, entries: THREADS * WRITES_PER_THREAD, broken_at: null });

      // Every write chained to a distinct predecessor (no two writers read the
      // same previous hash), so all prev_hash values are unique.
      const { rows } = await client.query("SELECT prev_hash FROM audit_log");
      const prevs = rows.map((r) => r.prev_hash);
      expect(new Set(prevs).size).toBe(prevs.length);
    } finally {
      client.release();
    }
  });
});
