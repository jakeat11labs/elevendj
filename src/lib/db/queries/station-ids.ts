import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessions, songRequests } from "@/lib/db/schema";
import { hashValue } from "@/lib/security";
import { STATION_ID_BRAND, STATION_ID_DURATION_MS } from "@/lib/station-id";
import type { QueueItem } from "@/lib/status";
import { dbCall, mapQueueItem, ownedSessionIds, recordEvent } from "./internal";


/** Personalization config read by the generation pipeline when building IDs. */
export async function getStationIdConfig(
  sessionId: string
): Promise<{ personalize: boolean; hostName: string | null } | null> {
  return dbCall(async () => {
    const [row] = await db
      .select({
        personalize: sessions.stationIdPersonalize,
        hostName: sessions.stationIdHostName,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    return row ?? null;
  });
}


/**
 * Create a station-ID request row (kind="station_id") in `queued` status, ready
 * for the generation pipeline. Not part of the public queue (position is null,
 * kind excludes it from `items` and request-scoped limits). The caller enqueues
 * generation for the returned id. Returns null if the session is gone.
 */
export async function createStationIdRequest(
  sessionId: string
): Promise<string | null> {
  return dbCall(async () => {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!session) {
      return null;
    }
    // Unique per call so the idempotency key never collides when the pool
    // top-up inserts several IDs in the same millisecond.
    const stamp = randomUUID();
    const [created] = await db
      .insert(songRequests)
      .values({
        sessionId: session.id,
        clientTokenHash: hashValue(`station-id:${sessionId}`, "client-token"),
        requesterName: "ElevenDJ Radio",
        kind: "station_id",
        prompt: STATION_ID_BRAND,
        normalizedPrompt: `station-id:${stamp}`,
        status: "queued",
        position: null,
        durationMs: STATION_ID_DURATION_MS,
        forceInstrumental: false,
        title: "Station ID",
        idempotencyKey: hashValue(
          `station-id:${sessionId}:${stamp}`,
          "idempotency"
        ),
      })
      .returning({ id: songRequests.id });
    await recordEvent(created.id, "station_id_created", {});
    return created.id;
  });
}


/** Ready station IDs (warm pool) for a session, oldest first. */
export async function listReadyStationIds(
  sessionId: string
): Promise<QueueItem[]> {
  return dbCall(async () => {
    const rows = await db
      .select()
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, sessionId),
          eq(songRequests.kind, "station_id"),
          eq(songRequests.status, "ready"),
          isNotNull(songRequests.audioUrl)
        )
      )
      .orderBy(asc(songRequests.createdAt));
    return rows.map(mapQueueItem);
  });
}


/**
 * Count station IDs that are already "warm or warming" (queued/generating/ready)
 * so the pool top-up only generates the shortfall.
 */
export async function countWarmStationIds(sessionId: string): Promise<number> {
  return dbCall(async () => {
    const [{ value }] = await db
      .select({ value: count() })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, sessionId),
          eq(songRequests.kind, "station_id"),
          inArray(songRequests.status, ["queued", "generating", "ready"])
        )
      );
    return value ?? 0;
  });
}


/** Mark a played station ID as archived so the pool top-up regenerates a fresh one. */
export async function consumeStationId(
  hostId: string,
  id: string
): Promise<void> {
  await dbCall(async () => {
    await db
      .update(songRequests)
      .set({ status: "archived" })
      .where(
        and(
          eq(songRequests.id, id),
          eq(songRequests.kind, "station_id"),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      );
    await recordEvent(id, "station_id_played", {});
  });
}
