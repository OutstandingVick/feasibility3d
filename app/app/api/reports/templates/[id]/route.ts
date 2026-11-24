import type { NextRequest } from "next/server";
import { ensureSchema, withClient } from "@/lib/server/db";
import { deleteTemplate, FormError } from "@/lib/server/written";
import { actorOrDefault, isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const id = Number((await params).id);
  try {
    await withClient((c) => deleteTemplate(c, id, actorOrDefault(req)));
    return Response.json({ id, deleted: true });
  } catch (e) {
    return Response.json({ error: "template_not_found", message: (e as FormError).message }, { status: 404 });
  }
}