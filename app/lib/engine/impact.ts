/**
 * Port of engine/impact.py — Fay gravity-viscous oil spreading + drift.
 */
import { pyRound, pyRoundInt } from "./rounding";
import type { Detection } from "./detect";
import type { Location } from "./locate";
import type { Quantification } from "./quantify";
import type { Scenario } from "./types";

const WATER_DENSITY = 1000.0;
const G = 9.81;
const WATER_KIN_VISCOSITY = 1.0e-6;
const FAY_K = 1.45;
const DEFAULT_HOURS = 6;
const CURRENT_MS = 0.05;
const WIND_MS = 2.0;
const WIND_FACTOR = 0.03;
const DRIFT_BEARING_DEG = 200.0;
const POLYGON_POINTS = 32;

export function slickRadiusM(volumeM3: number, hours: number, oilDensity: number): number {
  if (volumeM3 <= 0 || hours <= 0) return 0.0;
  const delta = (WATER_DENSITY - oilDensity) / WATER_DENSITY;
  const t = hours * 3600.0;
  const inner =
    (delta * G * volumeM3 ** 2 * t ** 1.5) / Math.sqrt(WATER_KIN_VISCOSITY);
  return FAY_K * inner ** (1.0 / 6.0);
}

export function driftM(hours: number): number {
  return (CURRENT_MS + WIND_FACTOR * WIND_MS) * hours * 3600.0;
}

export function offsetLonLat(
  lonlat: [number, number],
  eastM: number,
  northM: number,
): [number, number] {
  const [lon, lat] = lonlat;
  const dlat = northM / 110540.0;
  const dlon = eastM / (111320.0 * Math.cos((lat * Math.PI) / 180));
  return [lon + dlon, lat + dlat];
}

function round5(n: number): number {
  return pyRound(n, 5);
}

export function slickPolygon(centerLonLat: [number, number], radiusM: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < POLYGON_POINTS; i++) {
    const angle = (2.0 * Math.PI * i) / POLYGON_POINTS;
    const east = radiusM * Math.sin(angle);
    const north = radiusM * Math.cos(angle);
    const p = offsetLonLat(centerLonLat, east, north);
    pts.push([round5(p[0]), round5(p[1])]);
  }
  pts.push(pts[0]);
  return pts;
}

export interface Impact {
  type: string;
  model: string;
  hours_modelled: number;
  volume_spread_m3?: number;
  slick_radius_m?: number;
  slick_area_m2: number;
  center_lonlat?: [number, number];
  polygon_lonlat: [number, number][];
}

export function estimateImpact(
  detection: Detection,
  location: Location,
  quant: Quantification,
  scenario: Scenario,
  hours = DEFAULT_HOURS,
): Impact | null {
  if (!detection.detected) return null;
  const terrain = scenario.pipeline.terrain_at_leak;
  if (terrain !== "water") {
    return {
      type: "land",
      model: "not_modelled_v0.1",
      hours_modelled: hours,
      slick_area_m2: 0,
      polygon_lonlat: [],
    };
  }
  const volumeSpread = Math.min(quant.leak_rate_m3s * hours * 3600.0, quant.volume_m3);
  const radius = slickRadiusM(volumeSpread, hours, scenario.fluid.density_kg_m3);
  const distance = driftM(hours);
  const bearing = (DRIFT_BEARING_DEG * Math.PI) / 180;
  const east = distance * Math.sin(bearing);
  const north = distance * Math.cos(bearing);
  const center = offsetLonLat(location.location_lonlat, east, north);
  const area = Math.PI * radius * radius;
  return {
    type: "water",
    model: "fay_spreading+drift",
    hours_modelled: hours,
    volume_spread_m3: pyRound(volumeSpread, 1),
    slick_radius_m: pyRound(radius, 0),
    slick_area_m2: pyRoundInt(area),
    center_lonlat: [round5(center[0]), round5(center[1])],
    polygon_lonlat: slickPolygon(center, radius),
  };
}
