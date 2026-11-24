import type { NextRequest } from "next/server";
import { getUser, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const user = getUser(req);
  if (!user) return unauthenticated();
  return Response.json({ user: { id: user.id, email: user.email, role: user.role } });
}
