import type { NextRequest } from "next/server";
import { ensureSchema, fileFormA, withClient } from "@/lib/server/db";
import { actorOrDefault, isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const { id } = await params;
  const body = (await req.json()) as { reference: string; filed_at?: string };
  try {
    const result = await withClient((client) =>
      fileFormA(client, id, actorOrDefault(req), body.reference, body.filed_at ?? null),
    );
    return Response.json(result);
  } catch {
    return Response.json({ error: "spill_not_found", message: "unknown spill id" }, { status: 404 });
  }
}
