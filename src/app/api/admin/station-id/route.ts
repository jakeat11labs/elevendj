import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import { consumeStationId, getActiveSessionForHost } from "@/lib/db";
import { AppError, errorResponse } from "@/lib/errors";
import { ensureStationIdPool } from "@/lib/station-id-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const consumeSchema = z.object({
  // The station ID that just finished playing on the stage.
  id: z.string(),
});

// Called best-effort by the stage when a station ID finishes: archive the one
// that played (so it leaves the warm pool) and top the pool back up with a
// fresh ad-libbed variation. Host-authenticated, mirroring /api/admin/playback;
// if the stage has no host token it simply skips this and the pool degrades to
// reusing the existing variations.
export async function POST(request: Request) {
  try {
    const user = await requireHost();

    const body = await request.json().catch(() => null);
    const parsed = consumeSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(400, "invalid_request", "Invalid station ID payload.");
    }

    await consumeStationId(user.id, parsed.data.id);

    const active = await getActiveSessionForHost(user.id);
    void ensureStationIdPool(active.id).catch((error) => {
      console.error("Station ID pool replenish failed", error);
    });

    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
