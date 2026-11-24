import type { NextRequest } from "next/server";
import { ensureSchema, setStatus, withClient } from "@/lib/server/db";
import { actorOrDefault, isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const { id } = await params;
  const body = (await req.json()) as { status: string; note?: string };
  try {
    await withClient((client) => setStatus(client, id, body.status, actorOrDefault(req), body.note));
  } catch (e) {
    return Response.json(
      { error: "invalid_transition", message: (e as Error).message },
      { status: 400 },
    );
  }
  return Response.json({ spill_id: id, status: body.status });
}
