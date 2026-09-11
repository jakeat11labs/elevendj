import "server-only";

import {
  applyPlaybackAction,
  countReadyRequests,
  createAutoDjRequest,
  getAutoDjConfig,
  getRoomPlaybackState,
} from "@/lib/db/queries";
import {
  AUTODJ_MAX_PER_PASS,
  AUTODJ_WINDDOWN_MS,
} from "@/lib/autodj";
import { enqueueGeneration } from "@/lib/enqueue";

// Orchestration lives here (not in the queries layer) so the DB layer never
// imports the enqueue → generation chain, which itself imports the DB layer.
// Callers are the route backstops above both. Same shape as station-id-pool.

/**
 * Top a room's queue up to its AutoDJ target, generating only the shortfall.
 * Human requests count toward the depth, so a busy room generates nothing.
 * Best-effort and safe to call on every poll: because in-flight generations
 * count, concurrent callers converge on the target instead of piling up.
 * Returns how many tracks it kicked off.
 */
export async function ensureAutoDjQueue(sessionId: string): Promise<number> {
  const config = await getAutoDjConfig(sessionId);
  if (!config || !config.enabled || !config.isActive) return 0;

  // Wind-down: a track started now would outlive the agenda block.
  if (
    config.agendaEndsAt &&
    config.agendaEndsAt.getTime() - Date.now() < AUTODJ_WINDDOWN_MS
  ) {
    return 0;
  }

  let started = 0;
  for (
    let i = 0;
    i < Math.min(config.target, AUTODJ_MAX_PER_PASS);
    i++
  ) {
    const id = await createAutoDjRequest(config);
    if (!id) break; // room is already at target (or session vanished)
    await enqueueGeneration(id);
    started++;
  }
  return started;
}

/**
 * Start an idle room that has something to play. Without this an unattended
 * offsite room stays silent even once AutoDJ has stocked it, because only an
 * explicit playback action bumps the revision.
 */
export async function maybeAutoStartRoom(sessionId: string): Promise<boolean> {
  const config = await getAutoDjConfig(sessionId);
  if (!config || !config.enabled || !config.autoplay || !config.isActive) {
    return false;
  }

  const playback = await getRoomPlaybackState(sessionId);
  if (playback.isPlaying) return false;

  // Something is already cued and simply paused — that's an operator decision,
  // not dead air, so leave it alone.
  if (playback.currentRequestId) return false;
  if ((await countReadyRequests(sessionId)) === 0) return false;

  try {
    await applyPlaybackAction(
      sessionId,
      { type: "local", id: "autodj" },
      { action: "play", expectedRevision: playback.revision }
    );
    return true;
  } catch {
    // Lost the revision race with a real operator — they win.
    return false;
  }
}

/** Keep a room stocked and, if it's sitting silent, get it going. */
export async function runAutoDj(sessionId: string): Promise<void> {
  await ensureAutoDjQueue(sessionId);
  await maybeAutoStartRoom(sessionId);
}
