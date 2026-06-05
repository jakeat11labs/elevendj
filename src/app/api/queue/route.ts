import { getQueueSnapshot, requireSessionByCode } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const code = new URL(request.url).searchParams.get("code");
    if (!code) {
      throw new AppError(400, "missing_code", "A session code is required.");
    }
    const session = await requireSessionByCode(code);
    const snapshot = await getQueueSnapshot(session.id);
    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
