import type { NextRequest } from "next/server";
import { ensureSchema, reportHistory, withClient } from "@/lib/server/db";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  return Response.json(await withClient((c) => reportHistory(c, limit)));
}