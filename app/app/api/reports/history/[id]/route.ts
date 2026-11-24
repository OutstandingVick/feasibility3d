import type { NextRequest } from "next/server";
import { ensureSchema, reportFile, withClient } from "@/lib/server/db";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const raw = (await params).id;
  const entryId = Number(raw.replace(/\.pdf$/, ""));
  const pdf = await withClient((c) => reportFile(c, entryId));
  if (!pdf) {
    return Response.json({ error: "report_not_found", message: "unknown report entry" }, { status: 404 });
  }
  return new Response(pdf as unknown as BodyInit, {
    headers: { "Content-Type": "application/pdf" },
  });
}