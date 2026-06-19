import "server-only";

import {
  countWarmStationIds,
  createStationIdRequest,
} from "@/lib/db/queries";
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
  const warm = await countWarmStationIds(sessionId);
  const missing = Math.max(0, target - warm);
  let started = 0;
  for (let i = 0; i < missing; i++) {
    const id = await createStationIdRequest(sessionId);
    if (!id) {
      break; // session vanished
    }
    await enqueueGeneration(id);
    started++;
  }
  return started;
}
