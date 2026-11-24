import { formList, sectionList } from "@/lib/server/written";
import { isAuthed, unauthenticated } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isAuthed(req as never)) return unauthenticated();
  return Response.json({ forms: formList().map(({ fields, ...rest }) => ({ ...rest, fields })), sections: sectionList() });
}