import type { NextRequest } from "next/server";
import { ensureSchema, notifications, withClient } from "@/lib/server/db";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  return Response.json(await withClient((client) => notifications(client)));
}
