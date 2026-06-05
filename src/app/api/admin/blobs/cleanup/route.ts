import { requireAdmin } from "@/lib/auth/admin";
import { cleanupOrphanBlobs } from "@/lib/admin-blob";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await requireAdmin();
    const result = await cleanupOrphanBlobs();
    return Response.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
