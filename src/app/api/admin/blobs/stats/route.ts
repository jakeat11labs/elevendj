import { requireAdmin } from "@/lib/auth/admin";
import { getBlobStats } from "@/lib/admin-blob";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const stats = await getBlobStats();
    return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
