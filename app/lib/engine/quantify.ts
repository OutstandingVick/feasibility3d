/**
 * Port of engine/quantify.py — released-volume quantification.
 */
import { pyRound, pyRoundInt } from "./rounding";
import type { Detection } from "./detect";
import type { Location } from "./locate";
import { pressureGradient } from "./locate";
import type { Reading, Scenario } from "./types";

const BBL_PER_M3 = 6.28981;
const DISCHARGE_COEFF = 0.61;

export function integratedVolume(rows: Reading[], detection: Detection): number {
  const imbalanceMean = detection.baseline.imbalance_mean;
  let total = 0.0;
  for (const row of rows) {
    if (detection.estimated_start! <= row.timestamp && row.timestamp < detection.shut_in_at!) {
      total += (row.q_in_m3s - row.q_out_m3s - imbalanceMean) * 60.0;
    }
  }
  return total;
}

export function steadyVolume(location: Location, detection: Detection): number {
  const imbalanceMean = detection.baseline.imbalance_mean;
  const avg = location.averages;
  const leakRate = avg.q_in_m3s - avg.q_out_m3s - imbalanceMean;
  return leakRate * detection.duration_hours! * 3600.0;
}

export function pressureAtLeak(location: Location, scenario: Scenario): number {
  const avg = location.averages;
  const gradient = pressureGradient(avg.q_in_m3s, scenario);
  return avg.p_in_bar - gradient * location.location_m;
}

export function equivalentHoleDiameter(
  leakRateM3s: number,
  pLeakBar: number,
  scenario: Scenario,
): number {
  if (pLeakBar <= 0) return 0.0;
  const density = scenario.fluid.density_kg_m3;
  const pressurePa = pLeakBar * 1e5;
  const area = leakRateM3s / (DISCHARGE_COEFF * Math.sqrt((2.0 * pressurePa) / density));
  return Math.sqrt((4.0 * area) / Math.PI);
}

export function volumeUncertaintyPct(rows: Reading[], detection: Detection): number {
  const imbalanceStd = detection.baseline.imbalance_std;
  const window = rows.filter(
    (r) => detection.estimated_start! <= r.timestamp && r.timestamp < detection.shut_in_at!,
  );
  const n = window.length;
  const nBaseline = 2880;
  const volume = integratedVolume(rows, detection);
  const meterNoise = 2.0 * imbalanceStd * Math.sqrt(n) * 60.0;
  const baselineBias = ((2.0 * imbalanceStd) / Math.sqrt(nBaseline)) * 60.0 * n;
  const pct = ((meterNoise + baselineBias) / volume) * 100.0 + 5.0;
  return pyRound(pct, 1);
}

export interface Quantification {
  leak_rate_m3s: number;
  volume_m3: number;
  volume_bbl: number;
  volume_steady_m3: number;
  methods_agree_pct: number;
  pressure_at_leak_bar: number;
  equivalent_hole_mm: number;
  uncertainty_pct: number;
  volume_range_m3: [number, number];
  method: string;
  cross_check: string;
}

export function quantify(
  rows: Reading[],
  detection: Detection,
  location: Location,
  scenario: Scenario,
): Quantification | null {
  if (!detection.detected) return null;
  const imbalanceMean = detection.baseline.imbalance_mean;
  const avg = location.averages;
  const leakRate = avg.q_in_m3s - avg.q_out_m3s - imbalanceMean;
  const volume = integratedVolume(rows, detection);
  const volumeM3 = pyRound(volume, 1);
  const volumeSteady = steadyVolume(location, detection);
  const pLeak = pressureAtLeak(location, scenario);
  const hole = equivalentHoleDiameter(leakRate, pLeak, scenario);
  const uncertainty = volumeUncertaintyPct(rows, detection);
  return {
    leak_rate_m3s: pyRound(leakRate, 5),
    volume_m3: volumeM3,
    volume_bbl: pyRoundInt(volumeM3 * BBL_PER_M3),
    volume_steady_m3: pyRound(volumeSteady, 1),
    methods_agree_pct: pyRound((Math.abs(volume - volumeSteady) / volume) * 100.0, 2),
    pressure_at_leak_bar: pyRound(pLeak, 2),
    equivalent_hole_mm: pyRound(hole * 1000.0, 1),
    uncertainty_pct: uncertainty,
    volume_range_m3: [
      pyRound(volume * (1.0 - uncertainty / 100.0), 1),
      pyRound(volume * (1.0 + uncertainty / 100.0), 1),
    ],
    method: "mass_balance",
    cross_check: "steady_state_average",
  };
}
