import type { NextRequest } from "next/server";
import { scenario } from "@/lib/engine/load";
import { ensureSchema, listPipelines, upsertPipeline, withClient } from "@/lib/server/db";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const rows = await withClient(async (c) => {
    await upsertPipeline(c, scenario);
    return listPipelines(c);
  });
  return Response.json(rows);
}