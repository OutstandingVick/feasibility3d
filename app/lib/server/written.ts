/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regulator-authored reports (Form A/B/C, custom) and saved templates,
 * ported from engine/written.py. Field schemas, prefill and validation are
 * shared so the API, dashboard and PDF all use one definition.
 */
import type { PoolClient } from "pg";
import { canonicalDumps, sha256Hex } from "../engine/hash";
import { sha256Bytes } from "./blob";
import { getSpill, log, recordReport } from "./db";
import { fmtInt, fmtNum, fmtUtc } from "./pdf";
import type { Scenario } from "../engine/types";

interface Field {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "datetime";
  required?: boolean;
  options?: string[];
  hint?: string;
}

function f(key: string, label: string, kind: Field["type"] = "text", extra: Partial<Field> = {}): Field {
  return { key, label, type: kind, ...extra };
}

interface FormDef {
  id: string;
  name: string;
  description: string;
  due: string | null;
  fields: Field[];
}

export const FORMS: Record<string, FormDef> = {
  "form-a": {
    id: "form-a",
    name: "Form A — Spill notification",
    description: "Alert the regulator within 24 hours of a spill.",
    due: "24 hours after detection",
    fields: [
      f("company_name", "Company name", "text", { required: true }),
      f("address", "Company address", "text", { required: true }),
      f("facility", "Facility or equipment", "text", { required: true }),
      f("location", "Location", "text", { required: true }),
      f("coordinate_format", "Coordinate format", "select", { options: ["Decimal degrees (DD)", "Degrees minutes seconds (DMS)"] }),
      f("latitude", "Latitude", "number", { required: true }),
      f("longitude", "Longitude", "number", { required: true }),
      f("date_observed", "Date observed", "datetime", { required: true }),
      f("terrain", "Terrain", "select", { options: ["Land", "Swamp", "Water", "Offshore"] }),
      f("estimated_volume_bbl", "Estimated volume (bbl)", "number"),
      f("extent_of_pollution", "Extent of pollution", "textarea", { required: true }),
      f("suspected_cause", "Suspected cause", "textarea"),
      f("immediate_actions", "Immediate actions taken", "textarea"),
      f("reported_by", "Reported by", "text", { required: true }),
    ],
  },
  "form-b": {
    id: "form-b",
    name: "Form B — Spill response",
    description: "Cause, impact and initial clean-up, within 2 weeks.",
    due: "14 days after detection",
    fields: [
      f("cause", "Cause of spill", "select", { required: true, options: ["Equipment failure", "Corrosion", "Sabotage / third-party interference", "Operational error", "Natural cause", "Under investigation"] }),
      f("cause_details", "Cause details", "textarea", { required: true }),
      f("jiv_date", "JIV date", "datetime"),
      f("jiv_participants", "JIV participants", "textarea"),
      f("volume_spilled_bbl", "Volume spilled (bbl)", "number", { required: true }),
      f("volume_recovered_bbl", "Volume recovered so far (bbl)", "number"),
      f("area_affected_m2", "Area affected (m²)", "number"),
      f("impact_description", "Impact on environment and communities", "textarea", { required: true }),
      f("containment_measures", "Containment measures", "textarea", { required: true }),
      f("cleanup_started", "Clean-up started", "datetime"),
      f("cleanup_contractor", "Clean-up contractor", "text"),
      f("prepared_by", "Prepared by", "text", { required: true }),
    ],
  },
  "form-c": {
    id: "form-c",
    name: "Form C — Clean-up report",
    description: "Clean-up completion, recovery and remediation status.",
    due: "After clean-up is completed",
    fields: [
      f("cleanup_completed", "Clean-up completed", "datetime", { required: true }),
      f("methods_used", "Clean-up methods used", "textarea", { required: true }),
      f("volume_recovered_bbl", "Total volume recovered (bbl)", "number", { required: true }),
      f("waste_generated", "Waste generated and disposal", "textarea", { required: true }),
      f("area_remediated_m2", "Area remediated (m²)", "number"),
      f("remediation_status", "Remediation status", "select", { required: true, options: ["Completed", "Ongoing", "Monitoring", "Not started"] }),
      f("post_cleanup_inspection", "Post clean-up inspection", "textarea"),
      f("certified_by", "Certified by", "text", { required: true }),
    ],
  },
  custom: {
    id: "custom",
    name: "Custom report",
    description: "Pick sections from the spill record and add your own notes.",
    due: null,
    fields: [f("summary", "Summary / notes", "textarea"), f("prepared_by", "Prepared by", "text", { required: true })],
  },
};

export const FORM_KINDS = ["form-a", "form-b", "form-c", "custom"];

export const SECTIONS = [
  { id: "summary", name: "Key figures" },
  { id: "timeline", name: "Timeline" },
  { id: "quantification", name: "Quantification" },
  { id: "location", name: "Location" },
  { id: "impact", name: "Impact" },
  { id: "compliance", name: "Compliance status" },
  { id: "audit", name: "Audit log" },
  { id: "evidence", name: "Evidence" },
  { id: "method", name: "Method & integrity" },
];

export function formList(): FormDef[] {
  return FORM_KINDS.map((k) => FORMS[k]);
}

export function sectionList(): typeof SECTIONS {
  return SECTIONS;
}

export class FormError extends Error {
  status: number;
  fields: string[];
  constructor(message: string, status = 400, fields: string[] = []) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function prefill(
  client: PoolClient,
  kind: string,
  spillId: string,
  scenario: Scenario,
): Promise<Record<string, unknown>> {
  if (!(kind in FORMS)) throw new FormError("unknown form type", 404);
  const spill = await getSpill(client, spillId);
  if (!spill) throw new FormError("unknown spill id", 404);
  const analysis = spill.analysis ?? {};
  const leak = analysis.leak ?? {};
  const quant = analysis.quantification ?? {};
  const impact = analysis.impact ?? {};
  const pipeline = scenario.pipeline;
  const fluid = scenario.fluid?.name ?? "";
  const [lon, lat] = (leak.location_lonlat ?? [null, null]).slice(0, 2);
  const km = leak.location_m;
  const terrain = String(leak.terrain || pipeline.terrain_at_leak || "");
  const cap = terrain ? terrain[0].toUpperCase() + terrain.slice(1) : "";
  const volume = quant.volume_bbl;

  if (kind === "form-a") {
    return {
      facility: `${spill.pipeline_id} (${(pipeline.type || "").replace("_", " ")}, ${fluid})`,
      location: km != null ? `KM ${fmtNum(km / 1000, 2)} on ${spill.pipeline_id}` : "",
      coordinate_format: "Decimal degrees (DD)",
      latitude: lat != null ? Math.round(lat * 1e5) / 1e5 : null,
      longitude: lon != null ? Math.round(lon * 1e5) / 1e5 : null,
      date_observed: spill.detected_at,
      terrain: ["Land", "Swamp", "Water", "Offshore"].includes(cap) ? cap : null,
      estimated_volume_bbl: volume,
      extent_of_pollution: impact.slick_area_m2
        ? `Modelled slick of ${fmtNum((impact.slick_area_m2 || 0) / 1e6, 2)} km² after ${impact.hours_modelled} h (${impact.model}).`
        : "",
      suspected_cause: "Under investigation — to be established at JIV",
      immediate_actions: spill.shut_in_at ? `Line shut in at ${fmtUtc(spill.shut_in_at)}` : "",
    };
  }
  if (kind === "form-b") {
    return {
      cause: "Under investigation",
      volume_spilled_bbl: volume,
      area_affected_m2: impact.slick_area_m2 ? Math.round(impact.slick_area_m2) : null,
    };
  }
  if (kind === "form-c") return {};
  return { summary: "" };
}

function clean(kind: string, fields: Record<string, unknown>): Record<string, unknown> {
  const form = FORMS[kind];
  if (!form) throw new FormError("unknown form type", 404);
  const out: Record<string, unknown> = {};
  const missing: string[] = [];
  const bad: string[] = [];
  for (const field of form.fields) {
    let value = fields[field.key];
    if (typeof value === "string") value = value.trim();
    if (value === "" || value === null || value === undefined) {
      if (field.required) missing.push(field.key);
      continue;
    }
    if (field.type === "number") {
      const n = Number(value);
      if (Number.isNaN(n)) {
        bad.push(field.key);
        continue;
      }
      value = n;
    } else if (field.type === "select" && field.options && !field.options.includes(String(value))) {
      bad.push(field.key);
      continue;
    } else if (field.type === "datetime" && Number.isNaN(new Date(String(value)).getTime())) {
      bad.push(field.key);
      continue;
    } else {
      value = String(value).slice(0, 5000);
    }
    out[field.key] = value;
  }
  if (missing.length) throw new FormError(`missing required fields: ${missing.join(", ")}`, 400, missing);
  if (bad.length) throw new FormError(`invalid values for: ${bad.join(", ")}`, 400, bad);
  return out;
}

function cleanSections(sections: unknown): string[] {
  const ids = SECTIONS.map((s) => s.id);
  const chosen = (Array.isArray(sections) ? sections : []).filter((s) => ids.includes(String(s)));
  return ids.filter((s) => chosen.includes(s));
}

interface SpillRow {
  id: string;
  pipeline_id: string;
  analysis: any;
  [k: string]: any;
}

async function buildWrittenPdf(
  kind: string,
  spillId: string,
  title: string,
  fields: Record<string, unknown>,
  spill: SpillRow,
  author: string,
  fingerprint: string,
): Promise<Buffer> {
  const { Report } = await import("./pdf");
  const r = await Report.create(fingerprint);
  r.title(`FEASIBILITY3D — ${title}`);
  r.subtitle(`${spillId} · ${spill.pipeline_id} · ${FORMS[kind].name}`);
  r.spacer();
  r.text(`Prepared by ${author} · Due: ${FORMS[kind].due ?? "—"}`);
  r.spacer();
  r.heading(kind === "custom" ? "Details" : "Form fields");
  for (const field of FORMS[kind].fields.filter((x) => !(kind === "custom" && x.key === "summary"))) {
    const v = fields[field.key];
    let text: string;
    if (v === null || v === undefined) text = "—";
    else if (field.type === "number") {
      const n = Number(v);
      text = field.key.endsWith("_bbl") || field.key.endsWith("_m2")
        ? `${fmtInt(n)}`
        : field.key === "latitude" || field.key === "longitude"
          ? `${fmtNum(n, 5)}`
          : `${fmtNum(n, 1)}`;
    } else if (field.type === "datetime") text = fmtUtc(String(v));
    else text = String(v).replace(/\n/g, " ");
    r.kv(field.label, text);
  }
  r.spacer();
  r.text(`Content fingerprint ${fingerprint}. Saved reports cannot be edited.`, 8);
  return r.finish();
}

export async function createReport(
  client: PoolClient,
  kind: string,
  spillId: string,
  fields: Record<string, unknown>,
  sections: unknown,
  title: string | null,
  actor: string,
  scenario: Scenario,
  templateId: number | null = null,
): Promise<any> {
  const cleanFields = clean(kind, fields ?? {});
  const cleanS = cleanSections(sections);
  if (kind === "custom" && cleanS.length === 0 && !cleanFields.summary) {
    throw new FormError("choose at least one section or write a summary");
  }
  const spill = await getSpill(client, spillId);
  if (!spill) throw new FormError("unknown spill id", 404);
  const finalTitle = (title ?? "").trim().slice(0, 200) || `${FORMS[kind].name} · ${spillId}`;
  const fingerprint = "sha256:" + sha256Hex(
    canonicalDumps({ kind, spill_id: spillId, fields: cleanFields, sections: cleanS }),
  );
  const pdf = await buildWrittenPdf(kind, spillId, finalTitle, cleanFields, spill, actor, fingerprint);
  const pdfSha = "sha256:" + sha256Bytes(pdf);

  const { rows } = await client.query(
    `INSERT INTO written_reports (spill_id, kind, title, fields_json, sections_json, template_id, sha256, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [spillId, kind, finalTitle, canonicalDumps(cleanFields), JSON.stringify(cleanS), templateId, pdfSha, actor, iso(new Date())],
  );
  const reportId = rows[0].id;
  await log(client, spillId, "report_created", actor, { report_id: reportId, kind, title: finalTitle, sha256: pdfSha });
  const entry = await recordReport(client, `written-${kind}`, { spill_id: spillId, report_id: reportId }, pdf, actor);
  const item = await getReport(client, reportId);
  item.history_id = entry.id;
  return item;
}

export async function getReport(client: PoolClient, reportId: number): Promise<any | null> {
  const { rows } = await client.query("SELECT * FROM written_reports WHERE id = $1", [reportId]);
  return rows.length ? row(rows[0]) : null;
}

export async function listReports(client: PoolClient, spillId?: string | null): Promise<any[]> {
  const { rows } = spillId
    ? await client.query("SELECT * FROM written_reports WHERE spill_id = $1 ORDER BY id DESC", [spillId])
    : await client.query("SELECT * FROM written_reports ORDER BY id DESC");
  return rows.map(row);
}

function row(r: any): any {
  return {
    ...r,
    fields: r.fields_json ? JSON.parse(r.fields_json) : {},
    sections: r.sections_json ? JSON.parse(r.sections_json) : [],
  };
}

export async function saveTemplate(
  client: PoolClient,
  name: string,
  kind: string,
  fields: Record<string, unknown>,
  sections: unknown,
  actor: string,
): Promise<any> {
  const nm = (name ?? "").trim().slice(0, 120);
  if (!nm) throw new FormError("template name is required", 400, ["name"]);
  const schema = new Set((FORMS[kind]?.fields ?? []).map((x) => x.key));
  const defaults = Object.fromEntries(
    Object.entries(fields ?? {}).filter(([k, v]) => schema.has(k) && v !== "" && v !== null),
  );
  const cleanS = cleanSections(sections);
  const { rows } = await client.query(
    `INSERT INTO report_templates (name, kind, fields_json, sections_json, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [nm, kind, canonicalDumps(defaults), JSON.stringify(cleanS), actor, iso(new Date())],
  );
  await log(client, null, "template_saved", actor, { template_id: rows[0].id, name: nm, kind });
  return row(rows[0]);
}

export async function listTemplates(client: PoolClient): Promise<any[]> {
  const { rows } = await client.query(
    "SELECT * FROM report_templates WHERE deleted_at IS NULL ORDER BY name",
  );
  return rows.map(row);
}

export async function deleteTemplate(client: PoolClient, templateId: number, actor: string): Promise<void> {
  const cur = await client.query(
    "SELECT name FROM report_templates WHERE id = $1 AND deleted_at IS NULL",
    [templateId],
  );
  if (cur.rows.length === 0) throw new FormError("unknown template", 404);
  await client.query("UPDATE report_templates SET deleted_at = $1 WHERE id = $2", [iso(new Date()), templateId]);
  await log(client, null, "template_deleted", actor, { template_id: templateId, name: cur.rows[0].name });
}