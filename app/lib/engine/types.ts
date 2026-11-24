/**
 * TypeScript ports of the engine algorithms, mirroring engine/*.py exactly.
 * Number rounding follows Python `round()` (round-half-to-even); the
 * canonical report hash matches engine/report.py.
 */

export interface Reading {
  timestamp: string;
  t: number; // epoch seconds (UTC)
  p_in_bar: number;
  p_out_bar: number;
  q_in_m3s: number;
  q_out_m3s: number;
}

export interface ScenarioPipeline {
  id: string;
  type: string;
  length_m: number;
  inner_diameter_m: number;
  roughness_m: number;
  terrain_at_leak: string;
  route_lonlat: [number, number][];
}

export interface Scenario {
  name: string;
  method_version: string;
  pipeline: ScenarioPipeline;
  fluid: { name: string; density_kg_m3: number; viscosity_pa_s: number };
  sensors: { sample_interval_s: number };
  normal_operation: { flow_m3s: number; p_in_bar: number; p_out_bar: number };
  timeline: { data_start: string; data_end: string };
}

/** Parse an ISO 8601 UTC timestamp ("…Z") into epoch seconds. */
export function parseEpochSeconds(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(iso);
  if (!m) throw new Error("bad timestamp: " + iso);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
}

/** Mean of a list (naive summation; within 1e-12 of Python's fsum for this data). */
export function mean(data: number[]): number {
  let sum = 0;
  for (const x of data) sum += x;
  return sum / data.length;
}

/** Population standard deviation, matching `statistics.pstdev`. */
export function pstdev(data: number[]): number {
  const m = mean(data);
  let ss = 0;
  for (const x of data) {
    const d = x - m;
    ss += d * d;
  }
  return Math.sqrt(ss / data.length);
}
