import type { NextRequest } from "next/server";
import { ensureSchema, withClient } from "@/lib/server/db";
import { FormError, listTemplates, saveTemplate } from "@/lib/server/written";
import { actorOrDefault, isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  return Response.json(await withClient((c) => listTemplates(c)));
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const body = await req.json();
  try {
    const tpl = await withClient((c) =>
      saveTemplate(c, body.name, body.kind, body.fields ?? {}, body.sections ?? [], actorOrDefault(req)),
    );
    return Response.json(tpl, { status: 201 });
  } catch (e) {
    const fe = e as FormError;
    return Response.json({ error: "invalid_template", message: fe.message, fields: fe.fields ?? [] }, { status: fe.status ?? 400 });
  }
}