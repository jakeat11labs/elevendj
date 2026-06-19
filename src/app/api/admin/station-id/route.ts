import { z } from "zod";

import { requireHost } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import { consumeStationId, getActiveSessionForHost } from "@/lib/db";
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
export const POST = route(async (request: Request) => {
  const user = await requireHost();

  const { id } = await parseBody(request, consumeSchema, {
    message: "Invalid station ID payload.",
  });

  await consumeStationId(user.id, id);

  const active = await getActiveSessionForHost(user.id);
  void ensureStationIdPool(active.id).catch((error) => {
    console.error("Station ID pool replenish failed", error);
  });

  return json({ ok: true });
});
