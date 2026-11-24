/**
 * PDF report builder (pdf-lib), content-equivalent to the Python reportlab
 * generators. Displayed numbers use round-half-up (44.15 -> 44.2); the hashed
 * engine values use half-even and are never re-rounded here.
 */
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import type { AnalyzeResponse } from "../engine/report";

const A4 = [595.28, 841.89] as const;
const M = 50; // margin

const C = {
  slate: rgb(0x11 / 255, 0x18 / 255, 0x27 / 255),
  body: rgb(0x37 / 255, 0x41 / 255, 0x51 / 255),
  muted: rgb(0x6b / 255, 0x72 / 255, 0x80 / 255),
  teal: rgb(0x14 / 255, 0xb8 / 255, 0xa6 / 255),
  red: rgb(0xef / 255, 0x44 / 255, 0x44 / 255),
  amber: rgb(0xf5 / 255, 0xa5 / 255, 0x24 / 255),
  rule: rgb(0xe5 / 255, 0xe7 / 255, 0xeb / 255),
};

function roundHalfUp(value: number, places = 0): number {
  return Number(Math.round(Number(value + "e" + places)) + "e-" + places);
}

function fmtNum(value: number, dp = 1): string {
  return roundHalfUp(value, dp).toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function fmtInt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function fmtUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())} UTC`;
}

export class Report {
  private doc: PDFDocument;
  private page: PDFPage;
  private y: number;
  private fonts: {
    normal: Awaited<ReturnType<PDFDocument["embedFont"]>>;
    bold: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  };
  private fingerprint: string;

  private constructor(
    doc: PDFDocument,
    page: PDFPage,
    fonts: Report["fonts"],
    fingerprint: string,
  ) {
    this.doc = doc;
    this.page = page;
    this.y = A4[1] - M;
    this.fonts = fonts;
    this.fingerprint = fingerprint;
  }

  static async create(fingerprint: string): Promise<Report> {
    const doc = await PDFDocument.create();
    doc.setTitle("Feasibility3D report");
    doc.setAuthor("Feasibility3D");
    const normal = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([A4[0], A4[1]]);
    return new Report(doc, page, { normal, bold }, fingerprint);
  }

  private ensureSpace(h: number) {
    if (this.y - h < M + 20) {
      this.page = this.doc.addPage([A4[0], A4[1]]);
      this.y = A4[1] - M;
    }
  }

  text(s: string, size = 9, color = C.body, font?: "normal" | "bold") {
    // Standard PDF fonts are WinAnsi-encoded; map the few non-WinAnsi glyphs
    // the reports use to ASCII equivalents.
    const safe = s
      .replace(/\u2192/g, "->")
      .replace(/\u2014/g, "-")
      .replace(/\u2013/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/\u2248/g, "~")
      .replace(/[^\x00-\xFF]/g, "?");
    this.ensureSpace(size + 4);
    this.page.drawText(safe, {
      x: M,
      y: this.y,
      size,
      font: font === "bold" ? this.fonts.bold : this.fonts.normal,
      color,
    });
    this.y -= size + 4;
  }

  title(s: string) {
    this.text(s, 17, C.slate, "bold");
    this.y -= 4;
  }

  subtitle(s: string) {
    this.text(s, 9, C.muted);
  }

  heading(s: string) {
    this.y -= 6;
    this.text(s, 11, C.slate, "bold");
    this.page.drawLine({
      start: { x: M, y: this.y + 2 },
      end: { x: A4[0] - M, y: this.y + 2 },
      thickness: 1,
      color: C.teal,
    });
    this.y -= 6;
  }

  kv(label: string, value: string) {
    this.text(label, 8.5, C.body);
    this.text(value, 8.5, C.slate, "bold");
  }

  spacer(h = 8) {
    this.y -= h;
  }

  footer() {
    const pages = this.doc.getPages();
    const total = pages.length;
    pages.forEach((p, i) => {
      p.drawLine({
        start: { x: M, y: 30 },
        end: { x: A4[0] - M, y: 30 },
        thickness: 0.5,
        color: C.rule,
      });
      p.drawText(`Feasibility3D · feasibility3d-method v0.1 · Page ${i + 1} of ${total}`, {
        x: M,
        y: 20,
        size: 8,
        font: this.fonts.normal,
        color: C.muted,
      });
      p.drawText(this.fingerprint.replace("sha256:", "").slice(0, 12), {
        x: A4[0] - M - 60,
        y: 20,
        size: 8,
        font: this.fonts.normal,
        color: C.muted,
      });
    });
  }

  async finish(): Promise<Buffer> {
    this.footer();
    return Buffer.from(await this.doc.save());
  }
}

function header(r: Report, spillId: string, pipelineId: string, type: string, generated: string) {
  r.title("FEASIBILITY3D — Spill Report");
  r.subtitle(`${spillId} · ${pipelineId} · ${type} · generated ${generated}`);
  r.subtitle("Every spill found, measured and recorded.");
  r.spacer();
}

export async function spillReport(response: AnalyzeResponse, scenario: { pipeline: { length_m: number; type: string; id: string } }, spillId = "SPL-0001"): Promise<Buffer> {
  const r = await Report.create(response.report?.report_hash ?? "");
  header(
    r,
    spillId,
    response.pipeline_id,
    scenario.pipeline.type,
    fmtUtc(response.report?.generated_at),
  );

  if (!response.detected) {
    r.heading("No spill detected");
    r.text(
      `The analyzer found no sustained flow imbalance on this pipeline. Baseline window: ${fmtUtc(
        response.baseline.window_start,
      )} → ${fmtUtc(response.baseline.window_end)}.`,
    );
    return r.finish();
  }

  const leak = response.leak!;
  const q = response.quantification!;

  // Summary box (four columns, rendered as stacked labels).
  r.heading("Summary");
  r.kv("Volume released", `${fmtInt(q.volume_bbl)} bbl · ${fmtNum(q.volume_m3)} m³ · ±${q.uncertainty_pct}%`);
  r.kv("Location", `KM ${fmtNum(leak.location_m / 1000, 2)} ±${fmtInt(leak.location_uncertainty_m)} m`);
  r.kv("Coordinates", `${fmtNum(leak.location_lonlat[0], 5)}, ${fmtNum(leak.location_lonlat[1], 5)}`);
  r.kv("Detected", fmtUtc(leak.detected_at));
  r.kv("Release duration", `${fmtNum(leak.duration_hours, 1)} h · shut in ${fmtUtc(leak.shut_in_at)}`);
  r.spacer();

  r.heading("Timeline");
  r.kv("Baseline window", `${fmtUtc(response.baseline.window_start)} → ${fmtUtc(response.baseline.window_end)}`);
  r.kv("Deviation began", fmtUtc(leak.estimated_start));
  r.kv("Detected", fmtUtc(leak.detected_at));
  r.kv("Line shut in", fmtUtc(leak.shut_in_at));
  r.spacer();

  r.heading("Quantification");
  r.kv("Mean leak rate", `${fmtNum(q.leak_rate_m3s, 5)} m³/s`);
  r.kv("Volume (mass balance)", `${fmtNum(q.volume_m3)} m³`);
  r.kv("Steady-state cross-check", `${fmtNum(q.volume_steady_m3)} m³`);
  r.kv("Methods agree", `${q.methods_agree_pct}%`);
  r.kv("Pressure at leak", `${fmtNum(q.pressure_at_leak_bar, 2)} bar`);
  r.kv("Equivalent hole diameter", `${fmtNum(q.equivalent_hole_mm)} mm`);
  r.kv("Uncertainty", `±${q.uncertainty_pct}%`);
  r.kv("Volume range", `${fmtNum(q.volume_range_m3[0])} – ${fmtNum(q.volume_range_m3[1])} m³`);
  r.spacer();

  r.heading("Location");
  r.kv("Location along pipeline", `KM ${fmtNum(leak.location_m / 1000, 2)} (±${fmtInt(leak.location_uncertainty_m)} m)`);
  r.kv("Coordinates (lon, lat)", `${fmtNum(leak.location_lonlat[0], 5)}, ${fmtNum(leak.location_lonlat[1], 5)}`);
  r.spacer();

  r.heading("Impact");
  const impact = response.impact;
  if (impact && impact.polygon_lonlat.length > 0) {
    r.kv("Terrain", impact.type);
    r.kv("Model", impact.model);
    r.kv("Hours modelled", `${impact.hours_modelled} h`);
    r.kv("Slick area", `${fmtNum((impact.slick_area_m2 ?? 0) / 1e6, 2)} km²`);
    r.kv("Slick radius", `${fmtInt(impact.slick_radius_m ?? 0)} m`);
    r.kv("Volume spread", `${fmtNum(impact.volume_spread_m3 ?? 0)} m³`);
  } else {
    r.text("Impact not modelled for this terrain.");
  }
  r.spacer();

  r.heading("Method & integrity");
  r.text(`Method version: ${response.report?.method_version ?? "feasibility3d-method v0.1"}`);
  r.text("Physics: Darcy-Weisbach (Swamee-Jain), gradient-intersection location, mass-balance volume, orifice-equation hole size, Fay spreading.");
  r.spacer();
  r.text("Input hash", 8.5, C.body, "bold");
  r.text(response.report?.input_hash ?? "");
  r.text("Report hash", 8.5, C.body, "bold");
  r.text(response.report?.report_hash ?? "");
  r.spacer();
  r.text("Re-running feasibility3d-method v0.1 on the same input reproduces this report_hash exactly.", 8, C.muted);

  return r.finish();
}

export { fmtNum, fmtInt, fmtUtc, roundHalfUp };