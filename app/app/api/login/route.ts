import { NextRequest, NextResponse } from "next/server";
import { createToken, verifyPassword } from "@/lib/server/auth";
import { ensureSchema, getUserByEmail, withClient } from "@/lib/server/db";
import { setSessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  if (!process.env.COOKIE_SECRET) {
    return NextResponse.json(
      { error: "misconfigured", message: "COOKIE_SECRET is not set" },
      { status: 503 },
    );
  }
  await ensureSchema();
  const body = (await req.json()) as { email: string; password: string };
  const user = await withClient((client) =>
    getUserByEmail(client, body.email?.trim().toLowerCase()),
  );
  if (!user || !verifyPassword(body.password, user.password_hash)) {
    return NextResponse.json(
      { error: "invalid_credentials", message: "wrong email or password" },
      { status: 401 },
    );
  }
  const token = createToken(user.id, user.email, user.role);
  const res = NextResponse.json({ user: { id: user.id, email: user.email, role: user.role } });
  setSessionCookie(res, token);
  return res;
}
