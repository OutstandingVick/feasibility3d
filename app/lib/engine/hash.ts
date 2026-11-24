/**
 * SHA-256 and the canonical JSON encoding used by the tamper-evident report.
 *
 * The report hash is `sha256(json.dumps(obj, sort_keys=True,
 * separators=(",", ":")))` — the same canonical form Python's `report.py`
 * uses. Python distinguishes `int` (JSON `507`) from `float` (JSON `507.0`),
 * so the encoder needs to know which leaf numbers are integers; those are
 * listed in INT_PATHS. Everything else serialises as a float, with `.0`
 * appended for whole values.
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
  // JS Number#toString is the shortest round-trip; in the value ranges the
  // engine produces it equals Python's repr. Whole floats keep their ".0".
  if (Number.isInteger(n)) return n.toString() + ".0";
  return n.toString();
}

function escapeString(s: string): string {
  return JSON.stringify(s);
}

function dumps(value: unknown, path: string): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return escapeString(value);
  if (typeof value === "number") {
    return INT_PATHS.has(path) ? String(Math.round(value)) : pyFloatRepr(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => dumps(v, path)).join(",") + "]";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return (
      "{" +
      keys
        .map((k) => escapeString(k) + ":" + dumps((value as Record<string, unknown>)[k], joinPath(path, k)))
        .join(",") +
      "}"
    );
  }
  throw new Error("cannot serialise value of type " + typeof value);
}

function joinPath(path: string, key: string): string {
  return path ? path + "." + key : key;
}

/** Canonical JSON string matching Python `json.dumps(sort_keys=True, separators=(",", ":")). */
export function canonicalJson(value: unknown): string {
  return dumps(value, "");
}

/** `sha256:<hex>` of the canonical JSON encoding of `value`. */
export function canonicalHash(value: unknown): string {
  return "sha256:" + sha256Hex(canonicalJson(value));
}
