/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Additional report PDF builders (compliance, audit, period, Form A draft),
 * content-equivalent to engine/reports.py and engine/forms.py.
 */
import type { PoolClient } from "pg";
import type { Scenario } from "../engine/types";
import { formAStatus, getSpill, listSpills } from "./db";
import { fmtInt, fmtNum, fmtUtc, Report } from "./pdf";
import { spillReport } from "./pdf";
import type { AnalyzeResponse } from "../engine/report";

const STATUS_LABEL: Record<string, string> = {
  detected: "Detected", jiv: "JIV", cleanup: "Clean-up", closed: "Closed",
};

function deadline(iso: string | null, hours: number): string | null {
  if (!iso) return null;
  return new Date(new Date(iso).getTime() + hours * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function buildReport(
  type: string,
  params: { spill_id?: string; pipeline_id?: string; from?: string; to?: string },
  client: PoolClient,
  scenario: Scenario,
): Promise<Buffer> {
  if (type === "spill") {
    const spill = await getSpill(client, params.spill_id ?? "");
    if (!spill?.analysis) throw Object.assign(new Error("spill_id is required"), { status: 400 });
    return spillReport(spill.analysis as AnalyzeResponse, scenario, params.spill_id);
  }
  if (type === "compliance") return buildCompliance(client, scenario);
  if (type === "audit") return buildAudit(client, params.spill_id ?? "");
  if (type === "period") return buildPeriod(client, params.from ?? "", params.to ?? "");
  if (type === "form-a") {
    const spill = await getSpill(client, params.spill_id ?? "");
    if (!spill?.analysis) throw Object.assign(new Error("spill_id is required"), { status: 400 });
    return buildFormA(spill, scenario);
  }
  return spillReport((await getSpill(client, params.spill_id ?? ""))?.analysis as AnalyzeResponse, scenario, params.spill_id);
}

async function buildCompliance(client: PoolClient, scenario: Scenario): Promise<Buffer> {
  const spills = await listSpills(client);
  const r = await Report.create("compliance");
  r.title("FEASIBILITY3D — Compliance Status Report");
  r.subtitle("All pipelines · generated " + fmtUtc(new Date().toISOString()));
  r.spacer();
  const open = spills.filter((s) => s.status !== "closed").length;
  r.kv("Spills", String(spills.length));
  r.kv("Open", String(open));
  r.spacer();
  r.heading("Obligations by spill");
  for (const s of spills) {
    const detected = s.detected_at;
    const formA = await formAStatus(client, s.id);
    const idx = ({ detected: 0, jiv: 1, cleanup: 2, closed: 3 } as Record<string, number>)[s.status as string] ?? 0;
    const aDue = deadline(detected, 24);
    const aStatus = formA?.filed ? (formA.late ? "Filed (late)" : "Filed") : aDue && new Date(aDue) < new Date() ? "OVERDUE" : "Draft";
    const bDue = deadline(detected, 24 * 14);
    const bStatus = idx >= 1 ? "Done" : bDue && new Date(bDue) < new Date() ? "OVERDUE" : "Pending";
    const cDue = deadline(detected, 24 * 30);
    const cStatus = idx >= 2 ? "Done" : cDue && new Date(cDue) < new Date() ? "OVERDUE" : "Pending";
    r.text(
      `${s.id} · ${s.pipeline_id} — ${STATUS_LABEL[s.status] ?? s.status}`,
      10,
      undefined,
      "bold",
    );
    r.text(`Form A ${aStatus} (due ${fmtUtc(aDue)}); Form B ${bStatus} (due ${fmtUtc(bDue)}); Form C ${cStatus} (due ${fmtUtc(cDue)}).`, 8.5);
    r.spacer(4);
  }
  r.spacer();
  r.text("Due dates: Form A 24 h after detection; Form B 14 days and Form C 30 days after detection.", 8);
  return r.finish();
}

async function buildAudit(client: PoolClient, spillId: string): Promise<Buffer> {
  const spill = await getSpill(client, spillId);
  if (!spill) throw Object.assign(new Error("unknown spill id"), { status: 404 });
  const r = await Report.create(spill.report_hash ?? spillId);
  r.title("FEASIBILITY3D — Audit & Integrity Report");
  r.subtitle(`${spillId} · ${spill.pipeline_id}`);
  r.spacer();
  r.heading("Integrity");
  r.kv("Input hash", spill.input_hash ?? "—");
  r.kv("Report hash", spill.report_hash ?? "—");
  r.spacer();
  r.heading("Audit log");
  for (const a of spill.audit ?? []) {
    r.text(`${fmtUtc(a.at)} · ${a.actor ?? ""} · ${a.action}`, 8.5);
    r.text(a.detail_json ?? "", 8);
    r.spacer(3);
  }
  r.heading("Evidence");
  for (const e of spill.evidence ?? []) {
    r.text(`${e.filename} (${e.content_type}) — ${e.sha256}`, 8);
  }
  return r.finish();
}

async function buildPeriod(client: PoolClient, from: string, to: string): Promise<Buffer> {
  const spills = await listSpills(client);
  const start = new Date(from);
  const end = new Date(to);
  end.setUTCDate(end.getUTCDate() + 1);
  const inRange = spills.filter((s) => s.detected_at && new Date(s.detected_at) >= start && new Date(s.detected_at) < end);
  const totalBbl = inRange.reduce((sum, s) => sum + (s.volume_bbl ?? 0), 0);
  const r = await Report.create("period");
  r.title("FEASIBILITY3D — Period Summary");
  r.subtitle(`${from || "…"} – ${to || "…"}`);
  r.spacer();
  r.kv("Spills", String(inRange.length));
  r.kv("Volume released", `${fmtInt(totalBbl)} bbl`);
  r.spacer();
  r.heading("Spills in period");
  for (const s of inRange) {
    r.text(`${s.id} · ${s.pipeline_id} — ${fmtInt(s.volume_bbl ?? 0)} bbl · ${STATUS_LABEL[s.status] ?? s.status}`, 8.5);
  }
  return r.finish();
}

export async function buildFormA(spill: any, scenario: Scenario): Promise<Buffer> {
  const analysis = spill.analysis ?? {};
  const leak = analysis.leak ?? {};
  const quant = analysis.quantification ?? {};
  const [lon, lat] = (leak.location_lonlat ?? [null, null]).slice(0, 2);
  const r = await Report.create(analysis.report?.report_hash ?? "");
  r.title("Oil Spill Notification — Form A (Draft)");
  r.subtitle(`Reference ${spill.id}-A`);
  r.spacer();
  r.heading("1 · Facility / asset");
  r.kv("Pipeline id", spill.pipeline_id);
  r.kv("Pipeline type", scenario.pipeline.type === "trunk_line" ? "Trunk line" : "Flow line");
  r.kv("Fluid", scenario.fluid.name);
  r.heading("2 · Incident");
  r.kv("Spill began", fmtUtc(leak.estimated_start));
  r.kv("Detected", fmtUtc(leak.detected_at));
  r.kv("Line shut in", fmtUtc(leak.shut_in_at));
  r.kv("Notification deadline", fmtUtc(deadline(leak.detected_at ?? null, 24)));
  r.heading("3 · Location");
  r.kv("KM along pipeline", leak.location_m != null ? `KM ${fmtNum(leak.location_m / 1000, 2)}` : "—");
  r.kv("Coordinates (lat, lon)", `${lat != null ? fmtNum(lat, 5) : "—"}, ${lon != null ? fmtNum(lon, 5) : "—"}`);
  r.kv("Terrain", leak.terrain ?? "");
  r.kv("Uncertainty", `±${fmtInt(leak.location_uncertainty_m ?? 0)} m`);
  r.heading("4 · Estimated quantity");
  r.kv("Volume", `${fmtInt(quant.volume_bbl ?? 0)} bbl (${fmtNum(quant.volume_m3 ?? 0)} m³)`);
  r.kv("Range", `${fmtNum(quant.volume_range_m3?.[0] ?? 0)} – ${fmtNum(quant.volume_range_m3?.[1] ?? 0)} m³`);
  r.kv("Uncertainty", `±${quant.uncertainty_pct ?? 0}%`);
  r.heading("5 · Cause");
  r.text("Under investigation — to be established at JIV");
  r.heading("6 · Immediate actions");
  r.text(`Line shut in at ${fmtUtc(leak.shut_in_at)}`);
  r.heading("7 · Integrity");
  r.kv("Report hash", analysis.report?.report_hash ?? "");
  r.text("DRAFT — verify against the official NOSDRA/NUPRC Form A template before submission.", 8);
  return r.finish();
}

