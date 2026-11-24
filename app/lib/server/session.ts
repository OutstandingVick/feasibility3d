/**
 * Session + auth helpers for the API route handlers. Ports the engine's
 * cookie-based auth (open mode only when COOKIE_SECRET is unset).
 */
import type { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifyToken } from "./auth";

export interface User {
  id: number;
  email: string;
  role: string;
}

export function authEnabled(): boolean {
  return !!process.env.COOKIE_SECRET;
}

export function getUser(req: NextRequest): User | null {
  if (!authEnabled()) return null; // open mode
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return null;
  return {
    id: payload.uid as number,
    email: payload.email as string,
    role: payload.role as string,
  };
}

/** True when the request is allowed (open mode, or a valid session). */
export function isAuthed(req: NextRequest): boolean {
  return !authEnabled() || getUser(req) !== null;
}

/** The acting role from the X-Feasibility3D-Actor header (default regulator). */
export function actorOrDefault(req: NextRequest): string {
  return req.headers.get("x-feasibility3d-actor") ?? "demo-regulator";
}

export function cookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "none" | "lax" | "strict";
  path: string;
  maxAge: number;
} {
  const secure = (process.env.COOKIE_SECURE ?? "true").toLowerCase() !== "false";
  const samesiteRaw = (process.env.COOKIE_SAMESITE ?? "none").toLowerCase();
  const sameSite: "none" | "lax" | "strict" =
    samesiteRaw === "strict" ? "strict" : samesiteRaw === "lax" ? "lax" : "none";
  return { httpOnly: true, secure, sameSite, path: "/", maxAge: 7 * 24 * 3600 };
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, cookieOptions());
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

export function unauthenticated(): Response {
  return Response.json(
    { error: "unauthenticated", message: "log in first" },
    { status: 401 },
  );
}
