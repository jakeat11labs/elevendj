/**
 * Timeline helpers for remote player reconciliation.
 */

export function computePlayingPositionMs(opts: {
  basePositionMs: number;
  isPlaying: boolean;
  playbackStartedAt: string | Date | null;
  nowMs?: number;
}): number {
  const now = opts.nowMs ?? Date.now();
  if (!opts.isPlaying || !opts.playbackStartedAt) {
    return Math.max(0, opts.basePositionMs);
  }
  const started =
    opts.playbackStartedAt instanceof Date
      ? opts.playbackStartedAt.getTime()
      : new Date(opts.playbackStartedAt).getTime();
  if (!Number.isFinite(started)) {
    return Math.max(0, opts.basePositionMs);
  }
  return Math.max(0, opts.basePositionMs + (now - started));
}

/** Seek when absolute drift exceeds this threshold (ms). */
export const PLAYER_DRIFT_SEEK_MS = 750;

/** Device considered offline after this many ms without a heartbeat. */
export const PLAYER_OFFLINE_AFTER_MS = 12_000;

export function shouldSeekForDrift(
  localPositionMs: number,
  targetPositionMs: number,
  thresholdMs = PLAYER_DRIFT_SEEK_MS
): boolean {
  return Math.abs(localPositionMs - targetPositionMs) > thresholdMs;
}
