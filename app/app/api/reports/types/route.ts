import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const REPORT_TYPES = [
  { id: "spill", name: "Spill report", description: "Volume, location, timeline, impact and method for one spill.", scope: "spill", params: ["spill_id"] },
  { id: "form-a", name: "Form A draft", description: "Pre-filled NOSDRA Form A notification draft for one spill.", scope: "spill", params: ["spill_id"] },
  { id: "compliance", name: "Compliance status", description: "Form A, JIV, Form B/C deadlines and overdue items per spill.", scope: "pipeline", params: ["pipeline_id?"] },
  { id: "audit", name: "Audit & integrity", description: "Full audit log, evidence fingerprints and hash-chain verification.", scope: "spill", params: ["spill_id"] },
  { id: "period", name: "Period summary", description: "Spills, volume and time to detect for a date range, by pipeline and terrain.", scope: "period", params: ["from", "to"] },
];

export async function GET(req: Request) {
  if (!isAuthed(req as never)) return unauthenticated();
  return Response.json(REPORT_TYPES);
}