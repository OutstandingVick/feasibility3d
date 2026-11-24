/**
 * Ports of the evidence validation tests from the Python engine (test_db.py):
 * upload, SHA-256, size/type limits, and path-traversal safety.
 */
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Bytes } from "../../lib/server/blob";
import { addEvidence, getEvidence, initSchema, safeFilename } from "../../lib/server/db";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5435/feasibility3d";
process.env.DATABASE_URL = DATABASE_URL;

const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });

beforeAll(async () => {
  await initSchema();
  const client = await pool.connect();
  try {
    await client.query("TRUNCATE audit_log, spills, evidence RESTART IDENTITY");
    await client.query(
      `INSERT INTO spills (id, pipeline_id, status, report_hash, created_at, updated_at)
       VALUES ('SPL-0001','BYS-TL-01','detected','sha256:seed', now(), now())`,
    );
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool.end();
});

describe("evidence (Postgres + Blob/local)", () => {
  it("stores evidence with the correct SHA-256 and sanitised filename", async () => {
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    const client = await pool.connect();
    try {
      const rec = await addEvidence(
        client, "SPL-0001", "../../photo.png", "image/png", data, "note", "tester",
      );
      expect(rec.filename).toBe("photo.png");
      expect(rec.sha256).toBe(sha256Bytes(data));
      expect(rec.size_bytes).toBe(data.length);

      const got = await getEvidence(client, "SPL-0001", rec.id);
      expect(got.sha256).toBe(sha256Bytes(data));
    } finally {
      client.release();
    }
  });

  it("rejects oversized evidence", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    const client = await pool.connect();
    try {
      await expect(addEvidence(client, "SPL-0001", "big.png", "image/png", big, null, "tester"))
        .rejects.toMatchObject({ status: 413 });
    } finally {
      client.release();
    }
  });

  it("rejects unsupported content types", async () => {
    const client = await pool.connect();
    try {
      await expect(
        addEvidence(client, "SPL-0001", "notes.txt", "text/plain", Buffer.from([1]), null, "tester"),
      ).rejects.toMatchObject({ status: 415 });
    } finally {
      client.release();
    }
  });

  it("sanitises path-traversal in the filename", () => {
    expect(safeFilename("../../photo.png")).toBe("photo.png");
    expect(safeFilename("a/b/c/d.pdf")).toBe("d.pdf");
    expect(safeFilename("fine.csv")).toBe("fine.csv");
  });
});