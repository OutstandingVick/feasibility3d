import type { NextRequest } from "next/server";
import { getBlob } from "@/lib/server/blob";
import { ensureSchema, getEvidence, withClient } from "@/lib/server/db";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; evidenceId: string }> },
) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const { id, evidenceId } = await params;
  const record = await withClient((client) => getEvidence(client, id, Number(evidenceId)));
  if (!record) {
    return Response.json({ error: "evidence_not_found", message: "unknown evidence id" }, { status: 404 });
  }
  const bytes = await getBlob(record.stored_path);
  if (!bytes) {
    return Response.json({ error: "evidence_not_found", message: "stored file missing" }, { status: 404 });
  }
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": record.content_type,
      "Content-Disposition": `inline; filename="${record.filename}"`,
    },
  });
}