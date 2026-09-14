import "server-only";

import type { AutoDjConfig } from "@/lib/db/queries";
import {
  applyPlaybackAction,
  countReadyRequests,
  createAutoDjRequest,
  createHouseTrackRequest,
  getAutoDjConfig,
  getHouseTrackUsage,
  getRoomPlaybackState,
} from "@/lib/db/queries";
import {
  AUTODJ_MAX_PER_PASS,
  AUTODJ_WINDDOWN_MS,
} from "@/lib/autodj";
import { OFFSITE_HOUSE_PLAYLIST } from "@/lib/offsite-house-playlist";
import { enqueueGeneration } from "@/lib/enqueue";

// Orchestration lives here (not in the queries layer) so the DB layer never
// imports the enqueue → generation chain, which itself imports the DB layer.
// Callers are the route backstops above both. Same shape as station-id-pool.

/**
 * Try to fill one slot from the curated Offsite playlist.
 *
 * Only Offsite rooms get it — the playlist is written for Cancún 2026, so a
 * host's own session must keep generating to its own brief. Preferring these
 * over generation is free, instant and pre-reviewed; AutoDJ still covers the
 * room once every curated track is already queued.
 *
 * Least-recently-played first so a room works through the whole playlist before
 * repeating, with never-played tracks ahead of everything else.
 */
async function seedHouseTrack(config: AutoDjConfig): Promise<boolean> {
  if (config.source !== "integration") return false;

  // Deliberately not gated on forceInstrumental. That flag constrains what gets
  // generated from an open-ended guest prompt, where unvetted vocals are the
  // risk; these tracks are hand-reviewed and their vocals are the point. Station
  // IDs are injected on the same reasoning. Gating here would be a silent no-op
  // anyway — Offsite rooms are created with forceInstrumental defaulted to true.

  const { active, lastUsedAt } = await getHouseTrackUsage(config.sessionId);

  // Random tiebreak, not id order: every track starts out never-played, so
  // sorting by id alone would open every room in the building with the same
  // three songs and then walk the playlist alphabetically.
  const candidates = OFFSITE_HOUSE_PLAYLIST.filter(
    (track) => !active.has(track.id)
  )
    .map((track) => ({
      track,
      lastUsed: lastUsedAt.get(track.id) ?? 0,
      jitter: Math.random(),
    }))
    .sort((a, b) => a.lastUsed - b.lastUsed || a.jitter - b.jitter)
    .map((candidate) => candidate.track);

  for (const track of candidates) {
    const result = await createHouseTrackRequest(config, track);
    if (result.status === "created") return true;
    // The room filled up underneath us — stop, rather than probing the rest of
    // the playlist only to be refused each time.
    if (result.status === "at-target") return false;
  }
  return false;
}

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
    // Curated Offsite tracks first: free, instant and already reviewed. Falls
    // through to live generation once they're all queued.
    if (await seedHouseTrack(config)) {
      started++;
      continue;
    }

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
