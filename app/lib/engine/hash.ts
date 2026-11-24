/**
 * SHA-256 and the canonical JSON encodings used by the tamper-evident report
 * and the audit hash chain.
 *
 * Two canonical JSON forms are used, both matching Python's
 * `json.dumps(obj, sort_keys=True, separators=(",", ":"))`:
 *
 *  - `canonicalJson` (report hash): numbers are int vs float according to
 *    INT_PATHS, so a Python float like `507.0` serialises as `507.0` while a
 *    Python int `807237` serialises as `807237`.
 *  - `canonicalDumps` (audit chain): numbers are formatted by value — an
 *    integer-valued number serialises as an int (no trailing `.0`).
 */
import { createHash } from "node:crypto";

/** JSON paths (dot-joined, relative to the response root) that are ints. */
const INT_PATHS = new Set<string>([
  "leak.location_uncertainty_m",
  "quantification.volume_bbl",
  "impact.hours_modelled",
  "impact.slick_area_m2",
]);

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data as string).digest("hex");
}

/** Python's `repr(float)` shortest round-trip, with `.0` for whole floats. */
function pyFloatRepr(n: number): string {
  if (Number.isInteger(n)) return n.toString() + ".0";
  return n.toString();
}

function escapeString(s: string): string {
  return JSON.stringify(s);
}

function joinPath(path: string, key: string): string {
  return path ? path + "." + key : key;
}

function dumps(
  value: unknown,
  path: string,
  formatNumber: (n: number, path: string) => string,
): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return escapeString(value);
  if (typeof value === "number") return formatNumber(value, path);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => dumps(v, path, formatNumber)).join(",") + "]";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return (
      "{" +
      keys
        .map(
          (k) =>
            escapeString(k) +
            ":" +
            dumps((value as Record<string, unknown>)[k], joinPath(path, k), formatNumber),
        )
        .join(",") +
      "}"
    );
  }
  throw new Error("cannot serialise value of type " + typeof value);
}

/** Canonical JSON for the report hash (path-based int vs float). */
export function canonicalJson(value: unknown): string {
  return dumps(value, "", (n, path) =>
    INT_PATHS.has(path) ? String(Math.round(n)) : pyFloatRepr(n),
  );
}

/** `sha256:<hex>` of the canonical JSON encoding of `value` (report hash). */
export function canonicalHash(value: unknown): string {
  return "sha256:" + sha256Hex(canonicalJson(value));
}

/** Canonical JSON for the audit chain (value-based int vs float). */
export function canonicalDumps(value: unknown): string {
  return dumps(value, "", (n) => (Number.isInteger(n) ? String(n) : pyFloatRepr(n)));
}

/** SHA-256 of `prev_hash + canonical(payload)`, matching engine/db.py. */
export function auditEntryHash(
  prevHash: string,
  spillId: string | null,
  action: string,
  actor: string,
  detail: unknown,
  at: string,
): string {
  const payload = { spill_id: spillId, action, actor, detail, at };
  return "sha256:" + sha256Hex(prevHash + canonicalDumps(payload));
}
