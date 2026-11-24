/**
 * Port of engine/locate.py — leak location from steady-state pressure
 * gradients (gradient-intersection method), mapped onto the route.
 */
import type { Detection } from "./detect";
import { parseEpochSeconds, type Reading, type Scenario } from "./types";

/** Steady-state pressure gradient (bar/m) for flow q (Darcy-Weisbach). */
export function pressureGradient(q: number, scenario: Scenario): number {
  if (q <= 0) return 0.0;
  const pipe = scenario.pipeline;
  const fluid = scenario.fluid;
  const diameter = pipe.inner_diameter_m;
  const roughness = pipe.roughness_m;
  const density = fluid.density_kg_m3;
  const viscosity = fluid.viscosity_pa_s;
  const area = (Math.PI * diameter ** 2) / 4.0;
  const velocity = q / area;
  const reynolds = (density * velocity * diameter) / viscosity;
  const friction =
    0.25 / Math.log10(roughness / (3.7 * diameter) + 5.74 / reynolds ** 0.9) ** 2;
  return (((friction / diameter) * density * velocity ** 2) / 2.0) / 1e5;
}

export function steadyWindow(
  rows: Reading[],
  estimatedStart: string,
  shutInAt: string,
  settleMinutes = 15,
): Reading[] {
  const start = parseEpochSeconds(estimatedStart) + settleMinutes * 60;
  const end = parseEpochSeconds(shutInAt) - settleMinutes * 60;
  return rows.filter((row) => start <= row.t && row.t < end);
}

/** Interpolate the [lon, lat] route point at distance x metres from the inlet. */
export function pointAlongRoute(x: number, scenario: Scenario): [number, number] {
  const route = scenario.pipeline.route_lonlat;
  const length = scenario.pipeline.length_m;
  const r0 = [Math.round(route[0][0] * 1e5) / 1e5, Math.round(route[0][1] * 1e5) / 1e5] as [number, number];
  const rn = [
    Math.round(route[route.length - 1][0] * 1e5) / 1e5,
    Math.round(route[route.length - 1][1] * 1e5) / 1e5,
  ] as [number, number];
  if (x <= 0) return r0;
  if (x >= length) return rn;

  const segmentLengths: number[] = [];
  let total = 0.0;
  for (let i = 0; i < route.length - 1; i++) {
    const [lon1, lat1] = route[i];
    const [lon2, lat2] = route[i + 1];
    const distance = Math.hypot(lon2 - lon1, lat2 - lat1);
    segmentLengths.push(distance);
    total += distance;
  }
  const target = (x / length) * total;
  let accumulated = 0.0;
  for (let i = 0; i < route.length - 1; i++) {
    const distance = segmentLengths[i];
    if (accumulated + distance >= target) {
      const fraction = distance === 0 ? 0.0 : (target - accumulated) / distance;
      const [lon1, lat1] = route[i];
      const [lon2, lat2] = route[i + 1];
      const lon = lon1 + fraction * (lon2 - lon1);
      const lat = lat1 + fraction * (lat2 - lat1);
      return [
        Math.round(lon * 1e5) / 1e5,
        Math.round(lat * 1e5) / 1e5,
      ];
    }
    accumulated += distance;
  }
  return rn;
}

function locationM(pIn: number, pOut: number, gIn: number, gOut: number, length: number): number {
  return (pIn - pOut - gOut * length) / (gIn - gOut);
}

export interface Location {
  location_m: number;
  location_lonlat: [number, number];
  location_uncertainty_m: number;
  averages: { p_in_bar: number; p_out_bar: number; q_in_m3s: number; q_out_m3s: number };
  window_start: string;
  window_end: string;
}

export function locateLeak(
  rows: Reading[],
  detection: Detection,
  scenario: Scenario,
): Location | null {
  if (!detection.detected) return null;
  const window = steadyWindow(rows, detection.estimated_start!, detection.shut_in_at!);
  const count = window.length;
  const pIn = window.reduce((s, r) => s + r.p_in_bar, 0) / count;
  const pOut = window.reduce((s, r) => s + r.p_out_bar, 0) / count;
  const qIn = window.reduce((s, r) => s + r.q_in_m3s, 0) / count;
  const qOut = window.reduce((s, r) => s + r.q_out_m3s, 0) / count;
  const length = scenario.pipeline.length_m;
  const gIn = pressureGradient(qIn, scenario);
  const gOut = pressureGradient(qOut, scenario);
  let x = locationM(pIn, pOut, gIn, gOut, length);
  x = Math.max(0.0, Math.min(length, x));
  let uncertainty = 0.0;
  for (const dpIn of [-0.05, 0.05]) {
    for (const dpOut of [-0.05, 0.05]) {
      let alt = locationM(pIn + dpIn, pOut + dpOut, gIn, gOut, length);
      alt = Math.max(0.0, Math.min(length, alt));
      uncertainty = Math.max(uncertainty, Math.abs(alt - x));
    }
  }
  return {
    location_m: Math.round(x * 10) / 10,
    location_lonlat: pointAlongRoute(x, scenario),
    location_uncertainty_m: Math.round(uncertainty),
    averages: { p_in_bar: pIn, p_out_bar: pOut, q_in_m3s: qIn, q_out_m3s: qOut },
    window_start: window[0].timestamp,
    window_end: window[window.length - 1].timestamp,
  };
}
