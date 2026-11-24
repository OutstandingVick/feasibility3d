import type { NextRequest } from "next/server";
import { ensureSchema, removeContact, withClient } from "@/lib/server/db";
import { actorOrDefault, isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const contactId = Number((await params).id);
  try {
    await withClient((client) => removeContact(client, contactId, actorOrDefault(req)));
  } catch {
    return Response.json({ error: "contact_not_found", message: "unknown contact id" }, { status: 404 });
  }
  return Response.json({ id: contactId, removed: true });
}
