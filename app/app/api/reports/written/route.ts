import type { NextRequest } from "next/server";
import { scenario } from "@/lib/engine/load";
import { ensureSchema, withClient } from "@/lib/server/db";
import { createReport, FormError, listReports } from "@/lib/server/written";
import { actorOrDefault, isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const spillId = req.nextUrl.searchParams.get("spill_id");
  return Response.json(await withClient((c) => listReports(c, spillId)));
}

export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const body = await req.json();
  try {
    const report = await withClient((c) =>
      createReport(
        c,
        body.kind,
        body.spill_id,
        body.fields ?? {},
        body.sections ?? [],
        body.title ?? null,
        actorOrDefault(req),
        scenario,
        body.template_id ?? null,
      ),
    );
    return Response.json(report, { status: 201 });
  } catch (e) {
    const fe = e as FormError;
    return Response.json(
      { error: "invalid_report", message: fe.message, fields: fe.fields ?? [] },
      { status: fe.status ?? 400 },
    );
  }
}