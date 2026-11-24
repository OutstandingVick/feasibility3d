/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Postgres storage layer, ported from engine/db.py.
 *
 * Replaces SQLite with Postgres (Neon via DATABASE_URL). The audit hash chain
 * is unchanged from the Python engine, but writer serialisation uses
 * `pg_advisory_xact_lock` instead of a process lock, so it is safe across many
 * serverless instances (the thread lock in db.py only works inside one uvicorn
 * process).
 *
 * ``any`` is used deliberately for dynamic Postgres rows and JSON (spill
 * analysis payloads, audit details) that have no static shape at this layer.
 */
import { Pool, type PoolClient } from "pg";
import { auditEntryHash, canonicalDumps } from "../engine/hash";
import { hashPassword } from "./auth";
import { sha256Bytes } from "./blob";

function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set — provide a Postgres (Neon) connection string");
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
  }
  return pool;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Advisory-lock key that serialises all audit writes (arbitrary but fixed). */
const AUDIT_LOCK_KEY = 9034790234;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,
  length_m DOUBLE PRECISION,
  inner_diameter_m DOUBLE PRECISION,
  terrain_at_leak TEXT,
  route_json TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS spills (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT,
  status TEXT CHECK (status IN ('detected','jiv','cleanup','closed')),
  detected_at TEXT,
  estimated_start TEXT,
  shut_in_at TEXT,
  location_m DOUBLE PRECISION,
  location_lon DOUBLE PRECISION,
  location_lat DOUBLE PRECISION,
  volume_m3 DOUBLE PRECISION,
  volume_bbl INTEGER,
  uncertainty_pct DOUBLE PRECISION,
  input_hash TEXT,
  report_hash TEXT UNIQUE,
  analysis_json TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS evidence (
  id BIGSERIAL PRIMARY KEY,
  spill_id TEXT,
  filename TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  stored_path TEXT,
  note TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  spill_id TEXT,
  action TEXT,
  actor TEXT,
  detail_json TEXT,
  at TEXT,
  prev_hash TEXT,
  entry_hash TEXT
);
CREATE TABLE IF NOT EXISTS contacts (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'regulator',
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_spill ON audit_log (spill_id);
CREATE INDEX IF NOT EXISTS idx_evidence_spill ON evidence (spill_id);
`;

export async function initSchema(): Promise<void> {
  await withClient(async (client) => {
    await client.query(SCHEMA);
  });
}

let schemaPromise: Promise<void> | null = null;

/** Idempotent, memoised schema creation + first-admin bootstrap. */
export function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await initSchema();
      // Bootstrap the first admin from env when the users table is empty.
      const email = (process.env.ADMIN_EMAIL ?? "").trim();
      const password = process.env.ADMIN_PASSWORD ?? "";
      if (email && password) {
        await withClient(async (client) => {
          await bootstrapAdmin(client, email, hashPassword(password));
        });
      }
    })().catch((e) => {
      schemaPromise = null;
      throw e;
    });
  }
  return schemaPromise;
}

// --- Audit chain ---------------------------------------------------------

/**
 * Append an audit entry, assuming the caller already holds the advisory
 * lock (i.e. is inside `withAuditLock`). Mirrors `db.log`'s inner body.
 */
async function logLocked(
  client: PoolClient,
  spillId: string | null,
  action: string,
  actor: string,
  detail: unknown,
): Promise<void> {
  const detailJson = canonicalDumps(detail);
  const roundTripped = JSON.parse(detailJson);
  const at = nowUtc();
  const prev = await client.query("SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1");
  const prevHash = prev.rows[0]?.entry_hash ?? "GENESIS";
  const entry = auditEntryHash(prevHash, spillId, action, actor, roundTripped, at);
  await client.query(
    "INSERT INTO audit_log (spill_id, action, actor, detail_json, at, prev_hash, entry_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [spillId, action, actor, detailJson, at, prevHash, entry],
  );
}

/** Run a block inside one transaction that holds the advisory audit lock. */
export async function withAuditLock<T>(
  client: PoolClient,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1)", [AUDIT_LOCK_KEY]);
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

/** Append an audit entry on its own transaction (used by tests / standalone). */
export async function log(
  client: PoolClient,
  spillId: string | null,
  action: string,
  actor: string,
  detail: unknown,
): Promise<void> {
  await withAuditLock(client, () => logLocked(client, spillId, action, actor, detail));
}

export interface AuditVerification {
  ok: boolean;
  entries: number;
  broken_at: number | null;
}

export async function verifyAuditChain(client: PoolClient): Promise<AuditVerification> {
  const { rows } = await client.query("SELECT * FROM audit_log ORDER BY id");
  let prevHash = "GENESIS";
  let brokenAt: number | null = null;
  for (const row of rows) {
    const detail = row.detail_json ? JSON.parse(row.detail_json) : null;
    if (row.prev_hash !== prevHash) {
      brokenAt = row.id;
      break;
    }
    const expected = auditEntryHash(prevHash, row.spill_id, row.action, row.actor, detail, row.at);
    if (expected !== row.entry_hash) {
      brokenAt = row.id;
      break;
    }
    prevHash = row.entry_hash;
  }
  return { ok: brokenAt === null, entries: rows.length, broken_at: brokenAt };
}

// --- Spills --------------------------------------------------------------

function nextSpillId(lastId: string | null): string {
  const n = lastId ? parseInt(lastId.split("-")[1], 10) + 1 : 1;
  return "SPL-" + String(n).padStart(4, "0");
}

/** Persist a detected analysis as a spill record; idempotent on report_hash. */
export async function saveAnalysis(
  client: PoolClient,
  response: any,
  actor = "demo-regulator",
): Promise<string | null> {
  if (!response.detected) {
    await log(client, null, "analysis_no_spill", actor, { pipeline_id: response.pipeline_id });
    return null;
  }
  return withAuditLock(client, async () => {
    const reportHash = response.report?.report_hash;
    const existing = await client.query("SELECT id FROM spills WHERE report_hash = $1", [reportHash]);
    if (existing.rows.length > 0) {
      await logLocked(client, existing.rows[0].id, "analysis_rerun_identical", actor, {
        report_hash: reportHash,
      });
      return existing.rows[0].id as string;
    }
    const leak = response.leak ?? {};
    const quant = response.quantification ?? {};
    const lonlat = leak.location_lonlat ?? [null, null];
    const last = await client.query("SELECT id FROM spills ORDER BY id DESC LIMIT 1");
    const spillId = nextSpillId(last.rows[0]?.id ?? null);
    const now = nowUtc();
    await client.query(
      `INSERT INTO spills (id, pipeline_id, status, detected_at, estimated_start, shut_in_at,
        location_m, location_lon, location_lat, volume_m3, volume_bbl, uncertainty_pct,
        input_hash, report_hash, analysis_json, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        spillId,
        response.pipeline_id,
        "detected",
        leak.detected_at ?? null,
        leak.estimated_start ?? null,
        leak.shut_in_at ?? null,
        leak.location_m ?? null,
        lonlat[0],
        lonlat[1],
        quant.volume_m3 ?? null,
        quant.volume_bbl ?? null,
        quant.uncertainty_pct ?? null,
        response.report.input_hash ?? null,
        reportHash,
        JSON.stringify(response),
        now,
        now,
      ],
    );
    await logLocked(client, spillId, "spill_recorded", actor, { pipeline_id: response.pipeline_id });
    return spillId;
  });
}

const SPILL_COLUMNS =
  "id, pipeline_id, status, detected_at, estimated_start, shut_in_at, location_m, location_lon, location_lat, volume_m3, volume_bbl, uncertainty_pct, input_hash, report_hash, created_at, updated_at";

export async function listSpills(client: PoolClient, pipelineId?: string | null): Promise<any[]> {
  let q = `SELECT ${SPILL_COLUMNS} FROM spills`;
  const params: string[] = [];
  if (pipelineId) {
    q += " WHERE pipeline_id = $1";
    params.push(pipelineId);
  }
  q += " ORDER BY id DESC";
  const { rows } = await client.query(q, params);
  const out = [];
  for (const s of rows) {
    const c = await client.query("SELECT COUNT(*)::int AS n FROM evidence WHERE spill_id = $1", [s.id]);
    out.push({ ...s, evidence_count: c.rows[0].n });
  }
  return out;
}

export async function getSpill(client: PoolClient, spillId: string): Promise<any | null> {
  const { rows } = await client.query("SELECT * FROM spills WHERE id = $1", [spillId]);
  if (rows.length === 0) return null;
  const item = { ...rows[0] };
  item.analysis = item.analysis_json ? JSON.parse(item.analysis_json) : null;
  delete item.analysis_json;
  item.evidence = (await client.query("SELECT * FROM evidence WHERE spill_id = $1 ORDER BY id", [spillId])).rows;
  item.audit = (await client.query("SELECT * FROM audit_log WHERE spill_id = $1 ORDER BY id", [spillId])).rows;
  item.form_a = await formAStatus(client, spillId);
  return item;
}

const STATUS_FLOW: Record<string, string> = { detected: "jiv", jiv: "cleanup", cleanup: "closed" };

export async function setStatus(
  client: PoolClient,
  spillId: string,
  newStatus: string,
  actor = "demo-regulator",
  note?: string,
): Promise<void> {
  await withAuditLock(client, async () => {
    const cur = await client.query("SELECT status FROM spills WHERE id = $1", [spillId]);
    if (cur.rows.length === 0) throw new Error("unknown spill id");
    const current = cur.rows[0].status;
    if (STATUS_FLOW[current] !== newStatus) {
      throw new Error(`invalid transition from ${current} to ${newStatus}`);
    }
    await client.query("UPDATE spills SET status = $1, updated_at = $2 WHERE id = $3", [
      newStatus,
      nowUtc(),
      spillId,
    ]);
    await logLocked(client, spillId, "status_changed", actor, { from: current, to: newStatus, note: note ?? null });
  });
}

// --- Form A --------------------------------------------------------------

function formADeadline(detectedAt: string): string {
  const d = new Date(detectedAt);
  return new Date(d.getTime() + 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isLate(detectedAt: string, filedAt: string): boolean {
  return new Date(filedAt).getTime() > new Date(detectedAt).getTime() + 24 * 3600 * 1000;
}

export async function formAStatus(client: PoolClient, spillId: string): Promise<any | null> {
  const { rows } = await client.query(
    "SELECT detail_json FROM audit_log WHERE spill_id = $1 AND action = 'form_a_filed' ORDER BY id DESC LIMIT 1",
    [spillId],
  );
  if (rows.length === 0) return null;
  const d = JSON.parse(rows[0].detail_json);
  return { filed: true, late: !!d.late, reference: d.reference ?? null, filed_at: d.filed_at ?? null };
}

export async function fileFormA(
  client: PoolClient,
  spillId: string,
  actor: string,
  reference: string,
  filedAt?: string | null,
): Promise<any> {
  const actualFiledAt = filedAt || nowUtc();
  return withAuditLock(client, async () => {
    const cur = await client.query("SELECT detected_at FROM spills WHERE id = $1", [spillId]);
    if (cur.rows.length === 0) throw new Error("unknown spill id");
    const late = isLate(cur.rows[0].detected_at, actualFiledAt);
    await logLocked(client, spillId, "form_a_filed", actor, {
      reference,
      filed_at: actualFiledAt,
      late,
    });
    return { spill_id: spillId, filed: true, late, reference, filed_at: actualFiledAt };
  });
}

// --- Notifications -------------------------------------------------------

const AUDIT_TITLES: Record<string, string> = {
  spill_recorded: "Spill recorded",
  analysis_rerun_identical: "Analysis re-run (identical)",
  analysis_no_spill: "Analysis (no spill)",
  status_changed: "Status changed",
  evidence_added: "Evidence added",
  form_a_filed: "Form A filed",
  contact_added: "Contact added",
  contact_removed: "Contact removed",
  user_created: "User created",
  report_generated: "Report generated",
};

function auditDetail(action: string, detail: any): string {
  if (action === "status_changed") {
    let t = `${detail.from ?? ""} → ${detail.to ?? ""}`;
    if (detail.note) t += ` · ${detail.note}`;
    return t;
  }
  if (action === "evidence_added") return detail.filename ?? "";
  if (action === "analysis_rerun_identical") return (detail.report_hash ?? "").replace("sha256:", "");
  if (action === "form_a_filed") return detail.reference ?? "";
  if (action === "contact_added" || action === "contact_removed") return detail.name ?? "";
  if (action === "user_created") return detail.email ?? "";
  return detail.pipeline_id ?? "";
}

export async function notifications(client: PoolClient): Promise<any[]> {
  const items: any[] = [];
  const audit = await client.query("SELECT * FROM audit_log ORDER BY id DESC");
  for (const row of audit.rows) {
    const detail = row.detail_json ? JSON.parse(row.detail_json) : {};
    items.push({
      id: `audit-${row.id}`,
      kind: "audit",
      title: AUDIT_TITLES[row.action] ?? row.action,
      detail: auditDetail(row.action, detail),
      at: row.at,
      actor: row.actor,
      spill_id: row.spill_id,
      link: row.spill_id ? `/spills/${row.spill_id}` : "/",
    });
  }
  const spills = await client.query("SELECT id, detected_at FROM spills");
  for (const s of spills.rows) {
    if (!s.detected_at) continue;
    const filed = await client.query(
      "SELECT 1 FROM audit_log WHERE spill_id = $1 AND action = 'form_a_filed' LIMIT 1",
      [s.id],
    );
    if (filed.rows.length > 0) continue;
    const deadline = formADeadline(s.detected_at);
    items.push({
      id: `deadline-${s.id}`,
      kind: "deadline",
      title: "Form A due (24 h)",
      detail: "Notification to NOSDRA",
      at: deadline,
      actor: null,
      spill_id: s.id,
      link: `/spills/${s.id}`,
      overdue: new Date(deadline).getTime() < Date.now(),
    });
  }
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return items;
}

// --- Users ---------------------------------------------------------------

export async function userCount(client: PoolClient): Promise<number> {
  const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM users");
  return rows[0].n;
}

export async function getUserByEmail(client: PoolClient, email: string): Promise<any | null> {
  const { rows } = await client.query("SELECT * FROM users WHERE email = $1", [email]);
  return rows[0] ?? null;
}

export async function getUserById(client: PoolClient, id: number): Promise<any | null> {
  const { rows } = await client.query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function createUser(
  client: PoolClient,
  email: string,
  passwordHash: string,
  role: string,
  actor = "system",
): Promise<any> {
  return withAuditLock(client, async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) throw new Error("email is required");
    const existing = await client.query("SELECT id FROM users WHERE email = $1", [normalized]);
    if (existing.rows.length > 0) throw new Error("a user with that email already exists");
    const { rows } = await client.query(
      "INSERT INTO users (email, password_hash, role, created_at) VALUES ($1,$2,$3,$4) RETURNING *",
      [normalized, passwordHash, role, nowUtc()],
    );
    await logLocked(client, null, "user_created", actor, { email: normalized, role });
    return rows[0];
  });
}

export async function bootstrapAdmin(client: PoolClient, email: string, passwordHash: string): Promise<any | null> {
  if ((await userCount(client)) > 0) return null;
  return createUser(client, email, passwordHash, "admin", "system");
}

// --- Evidence ------------------------------------------------------------

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "application/pdf", "text/csv"]);

export function safeFilename(name: string): string {
  return (name || "").replace(/\\/g, "/").split("/").pop() || "file";
}

export async function addEvidence(
  client: PoolClient,
  spillId: string,
  filename: string,
  contentType: string,
  dataBytes: Buffer,
  note: string | null,
  actor: string,
): Promise<any> {
  if (dataBytes.length > MAX_EVIDENCE_BYTES) {
    throw Object.assign(new Error("file too large"), { status: 413 });
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw Object.assign(new Error("unsupported content type"), { status: 415 });
  }
  const safe = safeFilename(filename);
  const sha = sha256Bytes(dataBytes);
  const { putBlob } = await import("./blob");
  const location = await putBlob(sha, dataBytes, contentType);
  return withAuditLock(client, async () => {
    const { rows } = await client.query(
      `INSERT INTO evidence (spill_id, filename, content_type, size_bytes, sha256, stored_path, note, uploaded_by, uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [spillId, safe, contentType, dataBytes.length, sha, location, note ?? null, actor, nowUtc()],
    );
    await logLocked(client, spillId, "evidence_added", actor, { sha256: sha, filename: safe });
    return rows[0];
  });
}

export async function getEvidence(client: PoolClient, spillId: string, evidenceId: number): Promise<any | null> {
  const { rows } = await client.query("SELECT * FROM evidence WHERE id = $1 AND spill_id = $2", [
    evidenceId,
    spillId,
  ]);
  return rows[0] ?? null;
}

// --- Contacts ------------------------------------------------------------

export async function listContacts(client: PoolClient): Promise<any[]> {
  return (await client.query("SELECT * FROM contacts ORDER BY id")).rows;
}

export async function addContact(
  client: PoolClient,
  name: string,
  email: string | null,
  phone: string | null,
  actor: string,
): Promise<any> {
  return withAuditLock(client, async () => {
    const { rows } = await client.query(
      "INSERT INTO contacts (name, email, phone, created_at) VALUES ($1,$2,$3,$4) RETURNING *",
      [name, email, phone, nowUtc()],
    );
    await logLocked(client, null, "contact_added", actor, { name, email, phone });
    return rows[0];
  });
}

export async function removeContact(client: PoolClient, contactId: number, actor: string): Promise<void> {
  await withAuditLock(client, async () => {
    const cur = await client.query("SELECT name FROM contacts WHERE id = $1", [contactId]);
    if (cur.rows.length === 0) throw new Error("unknown contact id");
    await client.query("DELETE FROM contacts WHERE id = $1", [contactId]);
    await logLocked(client, null, "contact_removed", actor, { id: contactId, name: cur.rows[0].name });
  });
}
