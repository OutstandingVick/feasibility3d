/**
 * Ports of the DB-layer tests from the Python engine (test_db.py): status
 * workflow, audit-chain tamper detection, and idempotent analysis saving.
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initSchema, log, saveAnalysis, setStatus, verifyAuditChain } from "../../lib/server/db";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5435/feasibility3d";
process.env.DATABASE_URL = DATABASE_URL;

const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });

let client: Awaited<ReturnType<typeof pool.connect>>;

beforeAll(async () => {
  await initSchema();
  client = await pool.connect();
  await client.query("TRUNCATE audit_log, spills RESTART IDENTITY");
});

afterAll(async () => {
  client.release();
  await pool.end();
});

describe("db layer (Postgres)", () => {
  it("status workflow advances detected -> jiv -> cleanup -> closed", async () => {
    // Insert a detected spill directly, then walk the transitions.
    await client.query(
      `INSERT INTO spills (id, pipeline_id, status, report_hash, created_at, updated_at)
       VALUES ('SPL-0001','BYS-TL-01','detected','sha256:seed', now(), now())
       ON CONFLICT (id) DO UPDATE SET status='detected'`,
    );
    await client.query("TRUNCATE audit_log");

    await setStatus(client, "SPL-0001", "jiv", "tester", "JIV done");
    await setStatus(client, "SPL-0001", "cleanup", "tester");
    await setStatus(client, "SPL-0001", "closed", "tester");
    const { rows } = await client.query("SELECT status FROM spills WHERE id = 'SPL-0001'");
    expect(rows[0].status).toBe("closed");
    expect((await verifyAuditChain(client)).ok).toBe(true);
  });

  it("rejects an invalid (skipped) transition", async () => {
    await client.query("TRUNCATE audit_log");
    await client.query("UPDATE spills SET status='detected' WHERE id='SPL-0001'");
    await expect(setStatus(client, "SPL-0001", "cleanup", "tester")).rejects.toThrow(
      /invalid transition/,
    );
  });

  it("detects tampering in the audit chain", async () => {
    await client.query("TRUNCATE audit_log");
    await log(client, "SPL-0001", "spill_recorded", "tester", { pipeline_id: "BYS-TL-01" });
    await log(client, "SPL-0001", "evidence_added", "tester", {
      sha256: "abc",
      filename: "photo.png",
    });

    // Tamper with the first entry's detail.
    const first = await client.query("SELECT id FROM audit_log ORDER BY id LIMIT 1");
    await client.query("UPDATE audit_log SET detail_json = $1 WHERE id = $2", [
      '{"tampered":true}',
      first.rows[0].id,
    ]);

    const result = await verifyAuditChain(client);
    expect(result.ok).toBe(false);
    expect(result.broken_at).toBe(first.rows[0].id);
  });

  it("saveAnalysis is idempotent on report_hash", async () => {
    await client.query("TRUNCATE audit_log, spills RESTART IDENTITY");
    const response = {
      detected: true,
      pipeline_id: "BYS-TL-01",
      leak: { detected_at: null, estimated_start: null, shut_in_at: null, location_lonlat: [6.2, 4.8] },
      quantification: {},
      report: { report_hash: "sha256:abc123", input_hash: "sha256:def" },
    };
    const first = await saveAnalysis(client, response, "tester");
    const second = await saveAnalysis(client, response, "tester");
    expect(first).toBe("SPL-0001");
    expect(second).toBe("SPL-0001");
    const { rows } = await client.query("SELECT id FROM spills");
    expect(rows.length).toBe(1);
  });
});
