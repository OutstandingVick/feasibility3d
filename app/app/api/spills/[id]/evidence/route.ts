import type { NextRequest } from "next/server";
import { addEvidence, ensureSchema, withClient } from "@/lib/server/db";
import { actorOrDefault, isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const { id } = await params;
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) {
    return Response.json({ error: "file_required", message: "no file provided" }, { status: 400 });
  }
  const note = (form.get("note") as string | null) ?? null;
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const record = await withClient((client) =>
      addEvidence(client, id, file.name, file.type, bytes, note, actorOrDefault(req)),
    );
    return Response.json(record, { status: 201 });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 400;
    return Response.json({ error: "invalid_evidence", message: (e as Error).message }, { status });
  }
}