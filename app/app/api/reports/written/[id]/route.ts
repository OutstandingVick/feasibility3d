import type { NextRequest } from "next/server";
import { ensureSchema, withClient } from "@/lib/server/db";
import { getReport } from "@/lib/server/written";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const { id } = await params;
  const report = await withClient((c) => getReport(c, Number(id)));
  if (!report) {
    return Response.json({ error: "report_not_found", message: "unknown report" }, { status: 404 });
  }
  return Response.json(report);
}