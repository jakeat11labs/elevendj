import { requireHost } from "@/lib/auth/admin";
import { listFiles } from "@/lib/db";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireHost();

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId") ?? undefined;

    const files = await listFiles(user.id, sessionId);

    return Response.json(
      { files },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
