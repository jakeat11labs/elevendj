import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessions, songRequests } from "@/lib/db/schema";
import { hashValue } from "@/lib/security";
import {
  STATION_ID_BRAND,
  STATION_ID_DURATION_MS,
  STATION_ID_POOL_TARGET,
} from "@/lib/station-id";
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
  sessionId: string,
  target = STATION_ID_POOL_TARGET
): Promise<string | null> {
  return dbCall(async () => {
    // Unique per call so the idempotency key never collides when the pool
    // top-up inserts several IDs in the same millisecond.
    const stamp = randomUUID();
    const clientTokenHash = hashValue(
      `station-id:${sessionId}`,
      "client-token"
    );
    const idempotencyKey = hashValue(
      `station-id:${sessionId}:${stamp}`,
      "idempotency"
    );
    const result = await db.execute<{ id: string }>(sql`
      with room_lock as (
        select pg_advisory_xact_lock(hashtextextended(${sessionId}, 0))
      ),
      pool_state as (
        select
          exists(select 1 from sessions where id = ${sessionId}::uuid) as room_exists,
          (
            select count(*)
            from song_requests
            where session_id = ${sessionId}::uuid
              and kind = 'station_id'
              and status in ('queued', 'generating', 'ready')
          )::int as depth
        from room_lock
      )
      insert into song_requests (
        session_id,
        client_token_hash,
        requester_name,
        kind,
        prompt,
        normalized_prompt,
        status,
        position,
        duration_ms,
        force_instrumental,
        title,
        idempotency_key
      )
      select
        ${sessionId}::uuid,
        ${clientTokenHash},
        'ElevenDJ Radio',
        'station_id',
        ${STATION_ID_BRAND},
        ${`station-id:${stamp}`},
        'queued',
        null,
        ${STATION_ID_DURATION_MS},
        false,
        'Station ID',
        ${idempotencyKey}
      from pool_state
      where pool_state.room_exists and pool_state.depth < ${target}
      returning id
    `);
    const created = result.rows[0];
    if (!created) return null;
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
