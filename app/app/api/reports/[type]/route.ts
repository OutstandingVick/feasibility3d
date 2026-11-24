import type { NextRequest } from "next/server";
import { scenario } from "@/lib/engine/load";
import { ensureSchema, recordReport, withClient } from "@/lib/server/db";
import { buildReport } from "@/lib/server/reportsPdf";
import { actorOrDefault, isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const type = (await params).type.replace(/\.pdf$/, "");
  const sp = req.nextUrl.searchParams;
  const q = {
    spill_id: sp.get("spill_id") ?? undefined,
    pipeline_id: sp.get("pipeline_id") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  };
  try {
    const pdf = await withClient(async (client) => {
      const bytes = await buildReport(type, q, client, scenario);
      const sha = "sha256:" + (await import("@/lib/server/blob")).sha256Bytes(bytes);
      const entry = await recordReport(
        client,
        type,
        { spill_id: q.spill_id ?? null, pipeline_id: q.pipeline_id ?? null, from: q.from ?? null, to: q.to ?? null },
        bytes,
        actorOrDefault(req),
      );
      return { bytes, sha, entry };
    });
    return new Response(pdf.bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="feasibility3d-${type}.pdf"`,
        "X-Report-Sha256": pdf.sha,
      },
    });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 400;
    return Response.json({ error: "report_failed", message: (e as Error).message }, { status });
  }
}