import "server-only";

import { createStationIdRequest } from "@/lib/db/queries";
import { enqueueGeneration } from "@/lib/enqueue";
import { STATION_ID_POOL_TARGET } from "@/lib/station-id";

// Pool orchestration lives here (not in queries.ts) so the DB layer never
// imports the enqueue → generation chain, which itself imports the DB layer.
// Callers (settings + consume routes, the overview backstop) live above both.

/**
 * Top the warm pool up to `target` ready/in-flight station IDs for a session by
 * generating only the shortfall. Best-effort and idempotent enough to call on
 * every relevant event (enable, consume, host poll); each call generates at
 * most `target` jingles. Returns how many it kicked off.
 */
export async function ensureStationIdPool(
  sessionId: string,
  target: number = STATION_ID_POOL_TARGET
): Promise<number> {
  let started = 0;
  for (let i = 0; i < target; i++) {
    const id = await createStationIdRequest(sessionId, target);
    if (!id) {
      break; // target reached (or session vanished)
    }
    await enqueueGeneration(id);
    started++;
  }
  return started;
}
