import { requireHost } from "@/lib/auth/admin";
import { json, route } from "@/lib/api";
import { listFiles } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (request: Request) => {
  const user = await requireHost();

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") ?? undefined;

  const files = await listFiles(user.id, sessionId);

  return json({ files });
});
