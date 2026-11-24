/**
 * Loads the engine's static inputs — the active scenario and its sensor feed.
 * These are the deterministic scenario-01 fixtures (see app/tests/golden), so
 * the TS analysis reproduces the exact Python engine output.
 */
import scenarioRaw from "./data/scenario.json";
import readingsRaw from "./data/readings.json";
import type { Scenario } from "./types";

export const scenario: Scenario = scenarioRaw as unknown as Scenario;
export const readingsCsv: string = readingsRaw.csv;
