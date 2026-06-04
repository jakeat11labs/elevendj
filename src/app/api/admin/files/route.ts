import { assertAdmin } from "@/lib/admin-auth";
import { listFiles } from "@/lib/db";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertAdmin(request);

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId") ?? undefined;

    const files = await listFiles(sessionId);

    return Response.json(
      { files },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
