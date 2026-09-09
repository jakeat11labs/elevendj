import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessions, songRequests } from "@/lib/db/schema";
import type { SessionRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { STATION_ID_CADENCE } from "@/lib/station-id";
import { REALTIME_TOPIC, REQUEST_STATUSES, placeStationIds } from "@/lib/status";
import type { NowPlaying, QueueSnapshot, RequestStatus } from "@/lib/status";
import { activeStatuses, dbCall, mapQueueItem, mapSession } from "./internal";
import { getActiveSessionForHost, listSessionsForHost } from "./sessions";
import { getElevenLabsKeyStatus } from "./users";
import { listFiles } from "./requests";


// ─────────────────────────────────────────────────────────────────
// Playback (host-scoped) + now-playing (public, by session)
// ─────────────────────────────────────────────────────────────────

export async function setPlaybackState(
  hostId: string,
  requestId: string | null,
  isPlaying: boolean
): Promise<void> {
  const { setPlaybackStateWithRevision } = await import("./room-playback");
  await setPlaybackStateWithRevision(hostId, requestId, isPlaying);
}


export async function getNowPlaying(sessionId: string): Promise<NowPlaying> {
  return dbCall(async () => {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }

    const requestsOpen = session.requestsOpen;
    const autoApprove = session.autoApprove;

    if (!session.currentRequestId) {
      return { isPlaying: false, requestsOpen, autoApprove, track: null };
    }

    const [requestRow] = await db
      .select()
      .from(songRequests)
      .where(eq(songRequests.id, session.currentRequestId))
      .limit(1);

    if (!requestRow) {
      return {
        isPlaying: session.isPlaying,
        requestsOpen,
        autoApprove,
        track: null,
      };
    }

    return {
      isPlaying: session.isPlaying,
      requestsOpen,
      autoApprove,
      track: {
        id: requestRow.id,
        prompt: requestRow.prompt,
        requesterName: requestRow.requesterName,
        status: requestRow.status as RequestStatus,
      },
    };
  });
}


// ─────────────────────────────────────────────────────────────────
// Queue snapshots
// ─────────────────────────────────────────────────────────────────

async function buildQueueSnapshot(session: SessionRow): Promise<QueueSnapshot> {
  // Audience requests and the station-ID jingle pool share the table; we pull
  // them separately, count only the requests, then interleave jingles into the
  // queue (below) so display order and stage playback order come from one place.
  const [rows, stationIdRows] = await Promise.all([
    db
      .select()
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, session.id),
          eq(songRequests.kind, "request"),
          inArray(songRequests.status, activeStatuses)
        )
      )
      .orderBy(
        sql`${songRequests.position} asc nulls last`,
        asc(songRequests.createdAt)
      ),
    db
      .select()
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, session.id),
          eq(songRequests.kind, "station_id"),
          eq(songRequests.status, "ready"),
          isNotNull(songRequests.audioUrl)
        )
      )
      .orderBy(asc(songRequests.createdAt)),
  ]);

  const counts = Object.fromEntries(
    REQUEST_STATUSES.map((status) => [status, 0])
  ) as Record<RequestStatus, number>;

  // Real audience requests, counted toward statuses/limits before any station
  // IDs are interleaved (virtual jingles must never inflate counts).
  const songItems = rows.map((row) => {
    counts[row.status as RequestStatus] += 1;
    return mapQueueItem(row);
  });

  const stationIds = stationIdRows.map(mapQueueItem);

  // The queue the host/stage see is the single source of truth for where radio
  // IDs play: interleave the warm pool into the songs at computed slots. Only
  // ready, playable songs can anchor a jingle.
  const playableSongs = songItems.filter(
    (item) => item.status === "ready" && item.audioUrl
  );
  const pendingSongs = songItems.filter(
    (item) => !(item.status === "ready" && item.audioUrl)
  );
  const placed = placeStationIds(playableSongs, stationIds, {
    enabled: session.stationIdEnabled,
    isPlaying: session.isPlaying,
    currentId: session.currentRequestId,
    cadence: STATION_ID_CADENCE,
  });

  return {
    topic: `${REALTIME_TOPIC}:${session.publicCode}`,
    requestsOpen: session.requestsOpen,
    autoApprove: session.autoApprove,
    autoDjEnabled: session.autoDjEnabled,
    defaultDurationMs: session.defaultDurationMs,
    forceInstrumental: session.forceInstrumental,
    orbColorway: session.orbColorway,
    masterVolume: session.masterVolume,
    stationIdEnabled: session.stationIdEnabled,
    stationIds,
    crossfadeEnabled: session.crossfadeEnabled,
    // Placed (ready) songs with jingles interleaved, followed by songs still
    // generating/pending (which keep their natural order at the tail).
    items: [...placed, ...pendingSongs],
    counts,
  };
}


/** Public queue snapshot for a session id (request line / stage). */
export async function getQueueSnapshot(sessionId: string): Promise<QueueSnapshot> {
  return dbCall(async () => {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!session) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }
    return buildQueueSnapshot(session);
  });
}


export async function getAdminOverview(hostId: string) {
  return dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    const [sessionRow] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, active.id))
      .limit(1);

    const [queue, recent, files, sessionList, apiKey] = await Promise.all([
      buildQueueSnapshot(sessionRow),
      db
        .select()
        .from(songRequests)
        .where(
          and(
            eq(songRequests.sessionId, active.id),
            eq(songRequests.kind, "request")
          )
        )
        .orderBy(desc(songRequests.createdAt))
        .limit(75),
      listFiles(hostId),
      listSessionsForHost(hostId),
      getElevenLabsKeyStatus(hostId),
    ]);

    return {
      activeSession: mapSession(sessionRow),
      queue,
      recent: recent.map(mapQueueItem),
      files,
      sessions: sessionList,
      apiKey,
    };
  });
}
