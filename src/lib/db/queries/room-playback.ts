import "server-only";

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { playbackEvents, sessions, songRequests } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import type {
  PlaybackAction,
  RoomPlaybackState,
} from "@/lib/playback/contracts";
import { computePlayingPositionMs } from "@/lib/playback/timeline";
import { dbCall, toIso } from "./internal";

type Actor = {
  type: "admin" | "integration" | "player" | "local";
  id: string;
  idempotencyKey?: string | null;
};

function mapPlaybackState(
  row: typeof sessions.$inferSelect
): RoomPlaybackState {
  const now = new Date();
  const positionMs = computePlayingPositionMs({
    basePositionMs: row.playbackPositionMs ?? 0,
    isPlaying: row.isPlaying,
    playbackStartedAt: row.playbackStartedAt,
    nowMs: now.getTime(),
  });
  return {
    sessionId: row.id,
    currentRequestId: row.currentRequestId,
    isPlaying: row.isPlaying,
    positionMs,
    playbackStartedAt: toIso(row.playbackStartedAt),
    revision: row.playbackRevision ?? 0,
    updatedAt: toIso(row.playbackUpdatedAt),
    serverTime: now.toISOString(),
  };
}

export async function getRoomPlaybackState(
  sessionId: string
): Promise<RoomPlaybackState> {
  return dbCall(async () => {
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!row) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }
    return mapPlaybackState(row);
  });
}

async function findIdempotentResult(
  sessionId: string,
  actor: Actor
): Promise<RoomPlaybackState | null> {
  if (!actor.idempotencyKey) return null;
  // Scoped to the room: a portal driving several rooms may reuse a natural key
  // like `play-agenda-42`, and a global match would replay room A's result for
  // room B while room B's command silently never runs.
  const [event] = await db
    .select()
    .from(playbackEvents)
    .where(
      and(
        eq(playbackEvents.sessionId, sessionId),
        eq(playbackEvents.actorType, actor.type),
        eq(playbackEvents.actorId, actor.id),
        eq(playbackEvents.idempotencyKey, actor.idempotencyKey)
      )
    )
    .limit(1);
  if (!event?.result) return null;
  return event.result as RoomPlaybackState;
}

/** Queue ordering key: position ascending with nulls last, then createdAt. */
type QueueCursor = { position: number | null; createdAt: Date };

function isAfterCursor(row: QueueCursor, cursor: QueueCursor): boolean {
  const rowPosition = row.position ?? Number.MAX_SAFE_INTEGER;
  const cursorPosition = cursor.position ?? Number.MAX_SAFE_INTEGER;
  if (rowPosition !== cursorPosition) return rowPosition > cursorPosition;
  return row.createdAt.getTime() > cursor.createdAt.getTime();
}

async function queueCursorFor(
  sessionId: string,
  trackId: string
): Promise<QueueCursor | null> {
  const [row] = await db
    .select({
      position: songRequests.position,
      createdAt: songRequests.createdAt,
    })
    .from(songRequests)
    .where(
      and(eq(songRequests.id, trackId), eq(songRequests.sessionId, sessionId))
    )
    .limit(1);
  return row ?? null;
}

/**
 * First ready track after `cursor`, or the head of the queue when `cursor` is
 * null. Advancing by ordering key rather than by the current track's index
 * keeps skip correct whatever that track's status is by the time we look.
 */
async function nextReadyTrackId(
  sessionId: string,
  cursor: QueueCursor | null
): Promise<string | null> {
  const rows = await db
    .select({
      id: songRequests.id,
      position: songRequests.position,
      createdAt: songRequests.createdAt,
    })
    .from(songRequests)
    .where(
      and(
        eq(songRequests.sessionId, sessionId),
        eq(songRequests.kind, "request"),
        eq(songRequests.status, "ready"),
        isNotNull(songRequests.audioUrl)
      )
    )
    .orderBy(
      sql`${songRequests.position} asc nulls last`,
      asc(songRequests.createdAt)
    );

  if (!cursor) return rows[0]?.id ?? null;
  return rows.find((row) => isAfterCursor(row, cursor))?.id ?? null;
}

async function validateReadyTrack(
  sessionId: string,
  trackId: string
): Promise<void> {
  const [row] = await db
    .select({ id: songRequests.id })
    .from(songRequests)
    .where(
      and(
        eq(songRequests.id, trackId),
        eq(songRequests.sessionId, sessionId),
        eq(songRequests.kind, "request"),
        eq(songRequests.status, "ready"),
        isNotNull(songRequests.audioUrl)
      )
    )
    .limit(1);
  if (!row) {
    throw new AppError(
      404,
      "track_not_found",
      "That track is not ready in this room."
    );
  }
}

async function markPlayed(trackId: string | null): Promise<void> {
  if (!trackId) return;
  await db
    .update(songRequests)
    .set({
      status: "played",
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(songRequests.id, trackId),
        inArray(songRequests.status, ["ready", "generating", "queued"])
      )
    );
}

async function writeSessionPlayback(
  sessionId: string,
  expectedRevision: number,
  patch: {
    currentRequestId: string | null;
    isPlaying: boolean;
    playbackPositionMs: number;
    playbackStartedAt: Date | null;
  }
): Promise<typeof sessions.$inferSelect> {
  const [updated] = await db
    .update(sessions)
    .set({
      currentRequestId: patch.currentRequestId,
      isPlaying: patch.isPlaying,
      playbackPositionMs: patch.playbackPositionMs,
      playbackStartedAt: patch.playbackStartedAt,
      playbackRevision: sql`${sessions.playbackRevision} + 1`,
      playbackUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.playbackRevision, expectedRevision)
      )
    )
    .returning();

  if (!updated) {
    const current = await getRoomPlaybackState(sessionId);
    throw new AppError(
      409,
      "stale_playback_revision",
      "Playback state changed. Refresh and retry.",
      undefined,
      { playback: current }
    );
  }
  return updated;
}

async function recordPlaybackEvent(
  sessionId: string,
  actor: Actor,
  action: string,
  expectedRevision: number,
  applied: RoomPlaybackState,
  payload: Record<string, unknown>
) {
  try {
    await db.insert(playbackEvents).values({
      sessionId,
      actorType: actor.type,
      actorId: actor.id,
      action,
      idempotencyKey: actor.idempotencyKey ?? null,
      expectedRevision,
      appliedRevision: applied.revision,
      payload,
      result: applied,
    });
  } catch (error) {
    // Unique idempotency race — caller should re-read.
    console.error("Failed to record playback event", error);
  }
}

/**
 * Apply a revision-checked playback action.
 * Uses compare-and-set on playbackRevision (single UPDATE … WHERE revision = ?)
 * because the Neon HTTP driver does not support interactive transactions.
 */
export async function applyPlaybackAction(
  sessionId: string,
  actor: Actor,
  action: PlaybackAction
): Promise<RoomPlaybackState> {
  return dbCall(async () => {
    const replay = await findIdempotentResult(sessionId, actor);
    if (replay) return replay;

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!session) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }

    const expected = action.expectedRevision;
    if ((session.playbackRevision ?? 0) !== expected) {
      throw new AppError(
        409,
        "stale_playback_revision",
        "Playback state changed. Refresh and retry.",
        undefined,
        { playback: mapPlaybackState(session) }
      );
    }

    const now = new Date();
    let nextCurrent = session.currentRequestId;
    let nextPlaying = session.isPlaying;
    let nextPosition = session.playbackPositionMs ?? 0;
    let nextStarted: Date | null = session.playbackStartedAt;
    // Marked played only once the compare-and-set below wins, so a lost race
    // can't leave a track played while the room still points at it.
    let playedTrackId: string | null = null;

    switch (action.action) {
      case "play": {
        if (!nextCurrent) {
          nextCurrent = await nextReadyTrackId(sessionId, null);
        }
        if (!nextCurrent) {
          nextPlaying = false;
          nextStarted = null;
          nextPosition = 0;
        } else {
          nextPlaying = true;
          nextStarted = now;
        }
        break;
      }
      case "pause": {
        nextPosition = computePlayingPositionMs({
          basePositionMs: session.playbackPositionMs ?? 0,
          isPlaying: session.isPlaying,
          playbackStartedAt: session.playbackStartedAt,
          nowMs: now.getTime(),
        });
        nextPlaying = false;
        nextStarted = null;
        break;
      }
      case "select": {
        await validateReadyTrack(sessionId, action.trackId);
        nextCurrent = action.trackId;
        nextPosition = 0;
        nextPlaying = action.autoplay !== false;
        nextStarted = nextPlaying ? now : null;
        break;
      }
      case "skip":
      case "ended": {
        const fromId =
          action.action === "ended" ? action.trackId : session.currentRequestId;
        if (action.action === "ended" && action.trackId !== session.currentRequestId) {
          // Another device already advanced — return current state without bumping.
          return mapPlaybackState(session);
        }
        playedTrackId = fromId;
        nextCurrent = await nextReadyTrackId(
          sessionId,
          fromId ? await queueCursorFor(sessionId, fromId) : null
        );
        nextPosition = 0;
        if (nextCurrent) {
          nextPlaying = true;
          nextStarted = now;
        } else {
          nextPlaying = false;
          nextStarted = null;
        }
        break;
      }
    }

    const updated = await writeSessionPlayback(sessionId, expected, {
      currentRequestId: nextCurrent,
      isPlaying: nextPlaying,
      playbackPositionMs: nextPosition,
      playbackStartedAt: nextStarted,
    });
    await markPlayed(playedTrackId);

    const state = mapPlaybackState(updated);
    await recordPlaybackEvent(
      sessionId,
      actor,
      action.action,
      expected,
      state,
      action as unknown as Record<string, unknown>
    );
    return state;
  });
}

/** Legacy host console helper — bumps revision while preserving position. */
export async function setPlaybackStateWithRevision(
  hostId: string,
  requestId: string | null,
  isPlaying: boolean
): Promise<void> {
  await dbCall(async () => {
    const { getActiveSessionForHost } = await import("./sessions");
    const active = await getActiveSessionForHost(hostId);
    const [session] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, active.id), eq(sessions.hostId, hostId)))
      .limit(1);
    if (!session) return;

    const now = new Date();
    let positionMs = session.playbackPositionMs ?? 0;
    if (session.isPlaying && !isPlaying) {
      positionMs = computePlayingPositionMs({
        basePositionMs: positionMs,
        isPlaying: true,
        playbackStartedAt: session.playbackStartedAt,
        nowMs: now.getTime(),
      });
    }
    if (requestId !== session.currentRequestId) {
      positionMs = 0;
    }

    await db
      .update(sessions)
      .set({
        currentRequestId: requestId,
        isPlaying,
        playbackPositionMs: positionMs,
        playbackStartedAt: isPlaying ? now : null,
        playbackRevision: sql`${sessions.playbackRevision} + 1`,
        playbackUpdatedAt: now,
        updatedAt: now,
      })
      .where(and(eq(sessions.id, active.id), eq(sessions.hostId, hostId)));
  });
}
