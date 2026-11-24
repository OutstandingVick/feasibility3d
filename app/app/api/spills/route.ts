import type { NextRequest } from "next/server";
import { ensureSchema, listSpills, withClient } from "@/lib/server/db";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const pipelineId = req.nextUrl.searchParams.get("pipeline_id") ?? null;
  return Response.json(await withClient((client) => listSpills(client, pipelineId)));
}
