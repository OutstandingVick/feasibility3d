import type { NextRequest } from "next/server";
import { scenario } from "@/lib/engine/load";
import { ensureSchema, withClient } from "@/lib/server/db";
import { FormError, prefill } from "@/lib/server/written";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const { kind } = await params;
  const spillId = req.nextUrl.searchParams.get("spill_id") ?? "";
  try {
    return Response.json(await withClient((c) => prefill(c, kind, spillId, scenario)));
  } catch (e) {
    const status = e instanceof FormError ? e.status : 400;
    return Response.json({ error: "prefill_failed", message: (e as Error).message }, { status });
  }
}