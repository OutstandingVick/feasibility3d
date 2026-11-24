import type { NextRequest } from "next/server";
import { readingsCsv, scenario } from "@/lib/engine/load";
import { analyze } from "@/lib/engine/report";
import { ensureSchema, saveAnalysis, withClient } from "@/lib/server/db";
import { actorOrDefault, isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const actor = actorOrDefault(req);
  const response = analyze(readingsCsv, scenario);
  const spillId = await withClient((client) => saveAnalysis(client, response, actor));
  return Response.json({ ...response, spill_id: spillId });
}
