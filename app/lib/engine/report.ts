/**
 * Port of engine/report.py — ties the chain together and produces the
 * /analyze contract response with tamper-evident SHA-256 hashes.
 */
import { canonicalHash, sha256Hex } from "./hash";
import { detect, parseReadings } from "./detect";
import { locateLeak } from "./locate";
import { quantify, type Quantification } from "./quantify";
import { estimateImpact, type Impact } from "./impact";
import { pyRound } from "./rounding";
import type { Scenario } from "./types";

export interface AnalyzeResponse {
  detected: boolean;
  pipeline_id: string;
  baseline: {
    q_in_m3s: number;
    q_out_m3s: number;
    p_in_bar: number;
    p_out_bar: number;
    window_start: string;
    window_end: string;
  };
  leak: {
    detected_at: string;
    estimated_start: string;
    shut_in_at: string | null;
    duration_hours: number;
    location_m: number;
    location_lonlat: [number, number];
    location_uncertainty_m: number;
    pipeline_type: string;
    terrain: string;
  } | null;
  quantification: Quantification | null;
  impact: Impact | null;
  report: {
    method_version: string;
    generated_at: string;
    input_hash: string;
    report_hash: string;
  };
}

function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Response with report_hash and generated_at removed (the hashed payload). */
function hashInput(response: AnalyzeResponse): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(response)) {
    if (key === "report") {
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          ([k]) => k !== "report_hash" && k !== "generated_at",
        ),
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function analyze(readingsCsv: string, scenario: Scenario): AnalyzeResponse {
  const rows = parseReadings(readingsCsv);
  const detection = detect(rows);
  const location = locateLeak(rows, detection, scenario);
  const quant = quantify(rows, detection, location!, scenario);
  const impact = estimateImpact(detection, location!, quant!, scenario);

  const baseline = detection.baseline;
  const baselineContract = {
    q_in_m3s: pyRound(baseline.q_in_mean, 5),
    q_out_m3s: pyRound(baseline.q_out_mean, 5),
    p_in_bar: pyRound(baseline.p_in_mean, 3),
    p_out_bar: pyRound(baseline.p_out_mean, 3),
    window_start: baseline.window_start,
    window_end: baseline.window_end,
  };

  let leakContract = null;
  if (detection.detected) {
    leakContract = {
      detected_at: detection.detected_at,
      estimated_start: detection.estimated_start,
      shut_in_at: detection.shut_in_at,
      duration_hours: pyRound(detection.duration_hours!, 2),
      location_m: location!.location_m,
      location_lonlat: location!.location_lonlat,
      location_uncertainty_m: location!.location_uncertainty_m,
      pipeline_type: scenario.pipeline.type,
      terrain: scenario.pipeline.terrain_at_leak,
    };
  }

  let quantContract = null;
  if (detection.detected && quant !== null) {
    quantContract = {
      leak_rate_m3s: quant.leak_rate_m3s,
      volume_m3: quant.volume_m3,
      volume_bbl: quant.volume_bbl,
      volume_steady_m3: quant.volume_steady_m3,
      methods_agree_pct: quant.methods_agree_pct,
      equivalent_hole_mm: quant.equivalent_hole_mm,
      pressure_at_leak_bar: quant.pressure_at_leak_bar,
      uncertainty_pct: quant.uncertainty_pct,
      volume_range_m3: quant.volume_range_m3,
      method: quant.method,
      cross_check: quant.cross_check,
    };
  }

  const response: AnalyzeResponse = {
    detected: detection.detected,
    pipeline_id: scenario.pipeline.id,
    baseline: baselineContract,
    leak: leakContract as AnalyzeResponse["leak"],
    quantification: quantContract as AnalyzeResponse["quantification"],
    impact: impact as AnalyzeResponse["impact"],
    report: {
      method_version: scenario.method_version,
      generated_at: nowUtc(),
      input_hash: "sha256:" + sha256Hex(readingsCsv),
      report_hash: "",
    },
  };
  response.report.report_hash = canonicalHash(hashInput(response));
  return response;
}

export function verify(response: AnalyzeResponse): boolean {
  return canonicalHash(hashInput(response)) === response.report.report_hash;
}
