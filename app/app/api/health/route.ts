import { authEnabled } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({
    status: "ok",
    method_version: "feasibility3d-method v0.1",
    auth_enabled: authEnabled(),
  });
}
