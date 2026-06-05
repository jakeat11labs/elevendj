import { requireHost } from "@/lib/auth/admin";
import { getActiveSessionForHost, regeneratePublicCode } from "@/lib/db";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issue a fresh public request-link code for the host's active session. */
export async function POST() {
  try {
    const user = await requireHost();
    const active = await getActiveSessionForHost(user.id);
    const session = await regeneratePublicCode(user.id, active.id);
    return Response.json(
      { ok: true, session },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
