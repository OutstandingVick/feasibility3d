import type { NextRequest } from "next/server";
import { readingsCsv, scenario } from "@/lib/engine/load";
import { analyze } from "@/lib/engine/report";
import { ensureSchema, getSpill, withClient } from "@/lib/server/db";
import { isAuthed, unauthenticated } from "@/lib/server/session";
import { buildFormA } from "@/lib/server/reportsPdf";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const spillId = req.nextUrl.searchParams.get("spill_id");
  const spill = spillId
    ? await withClient((c) => getSpill(c, spillId))
    : null;
  const target = spill?.analysis ? spill : { analysis: analyze(readingsCsv, scenario) };
  const pdf = await buildFormA({ ...(spill ?? {}), analysis: target.analysis }, scenario);
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="feasibility3d-form-a-${spillId ?? "SPL-0001"}-draft.pdf"`,
    },
  });
}