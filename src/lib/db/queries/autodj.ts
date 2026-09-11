import "server-only";

import { randomUUID } from "node:crypto";
import {
  and,
  count,
  eq,
  isNotNull,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db/client";
import { sessions, songRequests } from "@/lib/db/schema";
import { AUTODJ_CREDIT, buildAutoDjPrompt } from "@/lib/autodj";
import { hashValue, normalizePrompt } from "@/lib/security";
import { dbCall, recordEvent } from "./internal";

export type AutoDjConfig = {
  sessionId: string;
  enabled: boolean;
  target: number;
  brief: string | null;
  autoplay: boolean;
  isActive: boolean;
  sessionName: string;
  roomName: string | null;
  durationMs: number;
  forceInstrumental: boolean;
  agendaEndsAt: Date | null;
};

export async function getAutoDjConfig(
  sessionId: string
): Promise<AutoDjConfig | null> {
  return dbCall(async () => {
    const [row] = await db
      .select({
        id: sessions.id,
        enabled: sessions.autoDjEnabled,
        target: sessions.autoDjTarget,
        brief: sessions.autoDjBrief,
        autoplay: sessions.autoDjAutoplay,
        isActive: sessions.isActive,
        name: sessions.name,
        roomName: sessions.roomName,
        durationMs: sessions.defaultDurationMs,
        forceInstrumental: sessions.forceInstrumental,
        agendaEndsAt: sessions.agendaEndsAt,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!row) return null;
    return {
      sessionId: row.id,
      enabled: row.enabled,
      target: row.target,
      brief: row.brief,
      autoplay: row.autoplay,
      isActive: row.isActive,
      sessionName: row.name,
      roomName: row.roomName,
      durationMs: row.durationMs,
      forceInstrumental: row.forceInstrumental,
      agendaEndsAt: row.agendaEndsAt,
    };
  });
}

/** Room-scoped AutoDJ update, used by the Offsite console. */
export async function setRoomAutoDj(
  sessionId: string,
  patch: {
    enabled?: boolean;
    target?: number;
    brief?: string | null;
    autoplay?: boolean;
  }
): Promise<void> {
  await dbCall(async () => {
    const update: Partial<typeof sessions.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (patch.enabled !== undefined) update.autoDjEnabled = patch.enabled;
    if (patch.target !== undefined) update.autoDjTarget = patch.target;
    if (patch.autoplay !== undefined) update.autoDjAutoplay = patch.autoplay;
    if (patch.brief !== undefined) {
      update.autoDjBrief = patch.brief?.trim() || null;
    }
    await db.update(sessions).set(update).where(eq(sessions.id, sessionId));
  });
}

/** Ready, playable tracks — what the room could start right now. */
export async function countReadyRequests(sessionId: string): Promise<number> {
  return dbCall(async () => {
    const [{ value }] = await db
      .select({ value: count() })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, sessionId),
          eq(songRequests.kind, "request"),
          eq(songRequests.status, "ready"),
          isNotNull(songRequests.audioUrl)
        )
      );
    return value ?? 0;
  });
}

/**
 * Queue a house track in `queued` status, ready for the generation pipeline.
 * An ordinary `kind: "request"` row, so it plays, crossfades, and anchors
 * station IDs exactly like an audience request; `source: "auto"` is what marks
 * it as house-generated. The caller enqueues generation for the returned id.
 */
export async function createAutoDjRequest(
  config: AutoDjConfig
): Promise<string | null> {
  return dbCall(async () => {
    const prompt = buildAutoDjPrompt({
      brief: config.brief,
      sessionName: config.sessionName,
      roomName: config.roomName,
    });

    // Unique per call so neither the idempotency key nor the duplicate-prompt
    // guard can collide when a pass inserts several tracks at once.
    const stamp = randomUUID();
    const clientTokenHash = hashValue(
      `autodj:${config.sessionId}`,
      "client-token"
    );
    const idempotencyKey = hashValue(
      `autodj:${config.sessionId}:${stamp}`,
      "idempotency"
    );
    const normalizedPrompt = `${normalizePrompt(prompt)}:${stamp}`;

    // Serialize top-ups per room and re-check depth inside the INSERT. The old
    // count-then-insert path let concurrent player/portal polls all observe the
    // same shortfall and over-generate paid tracks.
    const result = await db.execute<{ id: string }>(sql`
      with room_lock as (
        select pg_advisory_xact_lock(
          hashtextextended(${config.sessionId}, 0)
        )
      ),
      queue_state as (
        select
          (
            select count(*)
            from song_requests
            where session_id = ${config.sessionId}::uuid
              and kind = 'request'
              and status in ('queued', 'generating', 'ready')
          )::int as depth,
          (
            select coalesce(max(position), 0)
            from song_requests
            where session_id = ${config.sessionId}::uuid
              and position is not null
          )::int as last_position
        from room_lock
      )
      insert into song_requests (
        session_id,
        client_token_hash,
        requester_name,
        source,
        kind,
        prompt,
        normalized_prompt,
        status,
        position,
        duration_ms,
        force_instrumental,
        idempotency_key
      )
      select
        ${config.sessionId}::uuid,
        ${clientTokenHash},
        ${AUTODJ_CREDIT},
        'auto',
        'request',
        ${prompt},
        ${normalizedPrompt},
        'queued',
        queue_state.last_position + 1,
        ${config.durationMs},
        ${config.forceInstrumental},
        ${idempotencyKey}
      from queue_state
      where queue_state.depth < ${config.target}
      returning id
    `);
    const created = result.rows[0];
    if (!created) return null;

    await recordEvent(created.id, "autodj_created", { prompt });
    return created.id;
  });
}