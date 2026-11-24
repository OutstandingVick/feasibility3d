import type { NextRequest } from "next/server";
import { scenario } from "@/lib/engine/load";
import { ensureSchema, getSpill, withClient } from "@/lib/server/db";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthed(req)) return unauthenticated();
  await ensureSchema();
  const spillId = req.nextUrl.searchParams.get("spill_id");
  const spill = spillId ? await withClient((c) => getSpill(c, spillId)) : null;
  const analysis = spill?.analysis ?? {};
  const leak = analysis.leak ?? {};
  const quant = analysis.quantification ?? {};
  const [lon, lat] = (leak.location_lonlat ?? [null, null]).slice(0, 2);
  const detected = leak.detected_at;
  const deadline = detected
    ? new Date(new Date(detected).getTime() + 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
    : null;
  return Response.json({
    draft: true,
    reference: `${spillId ?? "SPL-0001"}-A`,
    spill_id: spillId ?? "SPL-0001",
    pipeline: {
      id: analysis.pipeline_id ?? "",
      type: leak.pipeline_type ?? scenario.pipeline.type,
      fluid: scenario.fluid.name,
      length_m: scenario.pipeline.length_m,
      diameter_m: scenario.pipeline.inner_diameter_m,
    },
    incident: {
      spill_began_utc: leak.estimated_start ?? null,
      detected_utc: detected ?? null,
      shut_in_utc: leak.shut_in_at ?? null,
      deadline_utc: deadline,
    },
    location: {
      distance_m: leak.location_m ?? null,
      latitude: lat ?? null,
      longitude: lon ?? null,
      terrain: leak.terrain ?? null,
      uncertainty_m: leak.location_uncertainty_m ?? null,
    },
    quantity: {
      volume_bbl: quant.volume_bbl ?? null,
      volume_m3: quant.volume_m3 ?? null,
      volume_range_m3: quant.volume_range_m3 ?? [null, null],
      method: "pressure/flow mass balance, feasibility3d-method v0.1",
      uncertainty_pct: quant.uncertainty_pct ?? null,
    },
    cause: "Under investigation — to be established at JIV",
    immediate_actions: leak.shut_in_at ? `Line shut in at ${leak.shut_in_at}` : "",
    integrity: {
      report_hash: analysis.report?.report_hash ?? "",
      input_hash: analysis.report?.input_hash ?? "",
    },
  });
}