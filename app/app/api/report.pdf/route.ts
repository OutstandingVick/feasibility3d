import type { NextRequest } from "next/server";
import { readingsCsv, scenario } from "@/lib/engine/load";
import { analyze } from "@/lib/engine/report";
import { ensureSchema, getSpill, withClient } from "@/lib/server/db";
import { spillReport } from "@/lib/server/pdf";
import type { AnalyzeResponse } from "@/lib/engine/report";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const spillId = req.nextUrl.searchParams.get("spill_id");
  let response: AnalyzeResponse;
  if (spillId) {
    const spill = await withClient((c) => getSpill(c, spillId));
    if (!spill?.analysis) {
      return Response.json({ error: "spill_not_found", message: "unknown spill id" }, { status: 404 });
    }
    response = spill.analysis as AnalyzeResponse;
  } else {
    response = analyze(readingsCsv, scenario);
  }
  const pdf = await spillReport(response, scenario, spillId ?? undefined);
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="feasibility3d-spill-report-${spillId ?? "SPL-0001"}.pdf"`,
    },
  });
}