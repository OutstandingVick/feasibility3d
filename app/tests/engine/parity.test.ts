/**
 * Parity tests: the TypeScript engine must reproduce the Python engine's
 * outputs exactly. Numbers are compared within 1e-9 relative tolerance;
 * `report_hash` and `input_hash` must be byte-identical.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { detect, parseReadings } from "../../lib/engine/detect";
import { locateLeak } from "../../lib/engine/locate";
import { quantify } from "../../lib/engine/quantify";
import { estimateImpact } from "../../lib/engine/impact";
import { analyze, verify } from "../../lib/engine/report";
import type { Scenario } from "../../lib/engine/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(here, "..", "golden");
const SCENARIOS = ["scenario_01", "scenario_02"];

function loadJson(p: string): Any {
  return JSON.parse(readFileSync(p, "utf8"));
}

function relClose(actual: number, expected: number): boolean {
  const scale = Math.max(Math.abs(actual), Math.abs(expected), 1e-12);
  return Math.abs(actual - expected) <= 1e-9 * scale;
}

function assertClose(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === "number") {
    expect(relClose(actual as number, expected), `${path}: ${actual} vs ${expected}`).toBe(true);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path}: expected array`).toBe(true);
    (actual as unknown[]).forEach((v, i) => assertClose(v, expected[i], `${path}[${i}]`));
    return;
  }
  if (expected !== null && typeof expected === "object") {
    for (const k of Object.keys(expected)) {
      // generated_at is wall-clock time; it varies per run and is excluded
      // from the report hash, so it is not part of the parity contract.
      if (k === "generated_at") continue;
      assertClose((actual as Any)[k], expected[k], `${path}.${k}`);
    }
    return;
  }
  expect(actual, path).toBe(expected);
}

for (const name of SCENARIOS) {
  const dir = join(GOLDEN, name);
  const csv = readFileSync(join(dir, "readings.csv"), "utf8");
  const scenario = loadJson(join(dir, "scenario.json")) as Scenario;

  describe(`engine parity / ${name}`, () => {
    const rows = parseReadings(csv);
    const detection = detect(rows);
    const location = locateLeak(rows, detection, scenario);
    const quant = quantify(rows, detection, location!, scenario);
    const impactResult = estimateImpact(detection, location!, quant!, scenario);
    const response = analyze(csv, scenario);

    it("detect matches golden", () => {
      assertClose(detection, loadJson(join(dir, "detect.json")), "detect");
    });
    it("locate matches golden", () => {
      assertClose(location, loadJson(join(dir, "locate.json")), "locate");
    });
    it("quantify matches golden", () => {
      assertClose(quant, loadJson(join(dir, "quantify.json")), "quantify");
    });
    it("impact matches golden", () => {
      assertClose(impactResult, loadJson(join(dir, "impact.json")), "impact");
    });
    it("analyze matches golden", () => {
      assertClose(response, loadJson(join(dir, "analyze.json")), "analyze");
    });
    it("report_hash and input_hash are identical", () => {
      const golden = loadJson(join(dir, "analyze.json"));
      expect(response.report.report_hash).toBe(golden.report.report_hash);
      expect(response.report.input_hash).toBe(golden.report.input_hash);
    });
    it("verify() on the produced response passes", () => {
      expect(verify(response)).toBe(true);
    });
  });
}
