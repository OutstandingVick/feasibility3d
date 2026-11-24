import { scenario as fullScenario } from "@/lib/engine/load";

export const dynamic = "force-dynamic";
export async function GET() {
  const s = { ...fullScenario } as Record<string, unknown>;
  delete s.ground_truth;
  delete s.leak;
  return Response.json(s);
}
