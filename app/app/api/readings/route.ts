import type { NextRequest } from "next/server";
import { readingsCsv, scenario } from "@/lib/engine/load";
import { parseReadings } from "@/lib/engine/detect";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  const step = Math.max(1, Number(req.nextUrl.searchParams.get("step") ?? "10"));
  const rows = parseReadings(readingsCsv)
    .filter((_, i) => i % step === 0)
    .map((r) => ({
      timestamp: r.timestamp,
      p_in_bar: r.p_in_bar,
      p_out_bar: r.p_out_bar,
      q_in_m3s: r.q_in_m3s,
      q_out_m3s: r.q_out_m3s,
    }));
  return Response.json({ pipeline_id: scenario.pipeline.id, step, readings: rows });
}
