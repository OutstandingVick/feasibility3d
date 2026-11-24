/**
 * Authentication helpers, ported from engine/auth.py — PBKDF2 password hashing
 * and HMAC-signed session tokens (stateless), using only node:crypto.
 */
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "feasibility3d_session";
const PBKDF2_ITERATIONS = 200_000;
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

function secret(): string {
  return process.env.COOKIE_SECRET ?? "";
}

// --- Passwords -----------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const digest = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${digest.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const digest = parts[3];
  const candidate = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(digest, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// --- Session tokens ------------------------------------------------------

function sortedJson(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`);
  return "{" + parts.join(",") + "}";
}

export function createToken(
  userId: number,
  email: string,
  role: string,
  ttl: number = SESSION_TTL_SECONDS,
): string {
  const payload: Record<string, unknown> = {
    uid: userId,
    email,
    role,
    exp: Math.floor(Date.now() / 1000) + ttl,
  };
  const body = Buffer.from(sortedJson(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("hex");
  return `${body}.${sig}`;
}

export function verifyToken(token: string): Record<string, unknown> | null {
  if (!token || !secret()) return null;
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(body).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
