import type { NextRequest } from "next/server";
import { ensureSchema, getSpill, withClient } from "@/lib/server/db";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const { id } = await params;
  const spill = await withClient((client) => getSpill(client, id));
  if (spill === null) {
    return Response.json({ error: "spill_not_found", message: "unknown spill id" }, { status: 404 });
  }
  return Response.json(spill);
}
