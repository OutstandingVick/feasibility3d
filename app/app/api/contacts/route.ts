import type { NextRequest } from "next/server";
import { addContact, ensureSchema, listContacts, withClient } from "@/lib/server/db";
import { actorOrDefault, isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  return Response.json(await withClient((client) => listContacts(client)));
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const body = (await req.json()) as { name: string; email?: string; phone?: string };
  if (!body.name?.trim()) {
    return Response.json({ error: "invalid_contact", message: "name is required" }, { status: 400 });
  }
  const contact = await withClient((client) =>
    addContact(client, body.name.trim(), body.email ?? null, body.phone ?? null, actorOrDefault(req)),
  );
  return Response.json(contact, { status: 201 });
}
