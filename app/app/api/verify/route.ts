import type { NextRequest } from "next/server";
import { readingsCsv, scenario } from "@/lib/engine/load";
import { analyze, verify } from "@/lib/engine/report";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  const first = analyze(readingsCsv, scenario);
  const second = analyze(readingsCsv, scenario);
  return Response.json({
    repeatable: first.report.report_hash === second.report.report_hash && verify(first),
    report_hash: first.report.report_hash,
  });
}
