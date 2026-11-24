/**
 * Port of engine/detect.py — baseline, leak and shut-in detection.
 */
import { mean, parseEpochSeconds, pstdev, type Reading } from "./types";

export function parseReadings(csvText: string): Reading[] {
  const lines = csvText.split("\n");
  const rows: Reading[] = [];
  // Skip the header line; tolerate a trailing blank line.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line === "") continue;
    const cols = line.split(",");
    rows.push({
      timestamp: cols[0],
      t: parseEpochSeconds(cols[0]),
      p_in_bar: parseFloat(cols[1]),
      p_out_bar: parseFloat(cols[2]),
      q_in_m3s: parseFloat(cols[3]),
      q_out_m3s: parseFloat(cols[4]),
    });
  }
  return rows;
}

export interface Baseline {
  imbalance_mean: number;
  imbalance_std: number;
  q_in_mean: number;
  q_in_std: number;
  q_out_mean: number;
  q_out_std: number;
  p_in_mean: number;
  p_in_std: number;
  p_out_mean: number;
  p_out_std: number;
  window_start: string;
  window_end: string;
}

export function computeBaseline(rows: Reading[], hours = 48): Baseline {
  const window = rows.slice(0, hours * 60);
  const imbalances = window.map((r) => r.q_in_m3s - r.q_out_m3s);
  const qIns = window.map((r) => r.q_in_m3s);
  const qOuts = window.map((r) => r.q_out_m3s);
  const pIns = window.map((r) => r.p_in_bar);
  const pOuts = window.map((r) => r.p_out_bar);
  return {
    imbalance_mean: mean(imbalances),
    imbalance_std: pstdev(imbalances),
    q_in_mean: mean(qIns),
    q_in_std: pstdev(qIns),
    q_out_mean: mean(qOuts),
    q_out_std: pstdev(qOuts),
    p_in_mean: mean(pIns),
    p_in_std: pstdev(pIns),
    p_out_mean: mean(pOuts),
    p_out_std: pstdev(pOuts),
    window_start: window[0].timestamp,
    window_end: window[window.length - 1].timestamp,
  };
}

export interface LeakResult {
  detected_at: string;
  estimated_start: string;
}

export function detectLeak(
  rows: Reading[],
  baseline: Baseline,
  k = 5.0,
  confirmMinutes = 5,
): LeakResult | null {
  const threshold = baseline.imbalance_mean + k * baseline.imbalance_std;
  const windowEnd = baseline.window_end;

  let startIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].timestamp > windowEnd) {
      startIndex = i;
      break;
    }
  }
  if (startIndex === -1) return null;

  let runStart: Reading | null = null;
  let runLength = 0;
  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    const imbalance = row.q_in_m3s - row.q_out_m3s;
    const isAlert = imbalance > threshold && row.q_in_m3s > 0.001;
    if (isAlert) {
      if (runStart === null) runStart = row;
      runLength++;
      if (runLength >= confirmMinutes) {
        return { detected_at: row.timestamp, estimated_start: runStart.timestamp };
      }
    } else {
      runStart = null;
      runLength = 0;
    }
  }
  return null;
}

export function findShutIn(rows: Reading[], afterTs: string): string | null {
  for (const row of rows) {
    if (row.timestamp > afterTs && row.q_in_m3s < 0.001 && row.q_out_m3s < 0.001) {
      return row.timestamp;
    }
  }
  return null;
}

export interface Detection {
  detected: boolean;
  baseline: Baseline;
  detected_at: string | null;
  estimated_start: string | null;
  shut_in_at: string | null;
  duration_hours: number | null;
}

export function detect(rows: Reading[]): Detection {
  const baseline = computeBaseline(rows);
  const leak = detectLeak(rows, baseline);
  const detected = leak !== null;
  const detectedAt = leak ? leak.detected_at : null;
  const estimatedStart = leak ? leak.estimated_start : null;
  const shutInAt = detected && estimatedStart ? findShutIn(rows, estimatedStart) : null;
  let durationHours: number | null = null;
  if (detected && shutInAt !== null && estimatedStart !== null) {
    durationHours = (parseEpochSeconds(shutInAt) - parseEpochSeconds(estimatedStart)) / 3600.0;
  }
  return {
    detected,
    baseline,
    detected_at: detectedAt,
    estimated_start: estimatedStart,
    shut_in_at: shutInAt,
    duration_hours: durationHours,
  };
}
