import { assertAdmin } from "@/lib/admin-auth";
import { getAdminOverview } from "@/lib/db";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertAdmin(request);
    const overview = await getAdminOverview();
    return Response.json(overview, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
