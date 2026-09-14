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
  /** "integration" = Offsite agenda room, which gets the curated playlist. */
  source: string;
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
        source: sessions.source,
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
      source: row.source,
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
 * Per-track play history for a room, keyed by curated house-track id. Drives
 * rotation: the in-memory shuffle bag the players use for station IDs is no use
 * here because each serverless invocation starts with an empty one, so the
 * ordering has to come from the database instead.
 */
export type HouseTrackUsage = {
  /** Already queued/generating/ready in this room — must not be added twice. */
  active: Set<string>;
  /** Last time each track was added to this room. */
  lastUsedAt: Map<string, number>;
};

export async function getHouseTrackUsage(
  sessionId: string
): Promise<HouseTrackUsage> {
  return dbCall(async () => {
    const result = await db.execute<{
      house_track_id: string;
      active: boolean;
      last_used: string;
    }>(sql`
      select
        metadata->>'houseTrackId' as house_track_id,
        bool_or(status in ('queued', 'generating', 'ready')) as active,
        max(created_at) as last_used
      from song_requests
      where session_id = ${sessionId}::uuid
        and metadata ? 'houseTrackId'
      group by 1
    `);

    const active = new Set<string>();
    const lastUsedAt = new Map<string, number>();
    for (const row of result.rows) {
      if (!row.house_track_id) continue;
      if (row.active) active.add(row.house_track_id);
      lastUsedAt.set(row.house_track_id, new Date(row.last_used).getTime());
    }
    return { active, lastUsedAt };
  });
}

/** The curated-track fields this layer needs, structurally typed to keep the
 * DB layer from importing the (server-only, ~200 KB) playlist manifest. */
export type HouseTrackInput = {
  id: string;
  set: string;
  title: string;
  blurb: string;
  genre: string;
  url: string;
  durationMs: number;
  lyrics: unknown;
};

/**
 * Drop a pre-rendered house track straight into the queue as `ready`.
 *
 * Unlike createAutoDjRequest there is nothing to generate — the audio already
 * exists — so the row is inserted complete with audioUrl, title and timed
 * lyrics and never touches the generation pipeline or costs credits. It is
 * otherwise an ordinary `kind: "request"` row, so it plays, crossfades, drives
 * karaoke and anchors station IDs exactly like an audience request.
 *
 * The result distinguishes "room is full" from "another pass claimed this
 * track" so the caller knows whether to stop or try the next candidate —
 * without it, a room sitting at target would re-probe every track in the
 * playlist on every one-second player poll.
 */
export type HouseTrackInsert =
  | { status: "created"; id: string }
  | { status: "at-target" }
  | { status: "taken" };

export async function createHouseTrackRequest(
  config: AutoDjConfig,
  track: HouseTrackInput
): Promise<HouseTrackInsert> {
  return dbCall(async () => {
    const stamp = randomUUID();
    const clientTokenHash = hashValue(
      `house:${config.sessionId}`,
      "client-token"
    );
    const idempotencyKey = hashValue(
      `house:${config.sessionId}:${track.id}:${stamp}`,
      "idempotency"
    );
    const normalizedPrompt = `${normalizePrompt(track.blurb)}:house:${track.id}:${stamp}`;
    const metadata = JSON.stringify({
      houseTrackId: track.id,
      houseSet: track.set,
      genre: track.genre,
    });

    // Same advisory lock as the generated path so concurrent player polls can't
    // both observe the same shortfall. The extra `not exists` guard is what
    // stops two passes racing the same track into one room's queue.
    const result = await db.execute<{
      id: string | null;
      depth: number;
    }>(sql`
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
      ),
      inserted as (
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
        idempotency_key,
        audio_url,
        title,
        lyrics,
        metadata,
        completed_at
      )
      select
        ${config.sessionId}::uuid,
        ${clientTokenHash},
        null,
        'auto',
        'request',
        ${track.blurb},
        ${normalizedPrompt},
        'ready',
        queue_state.last_position + 1,
        ${track.durationMs},
        false,
        ${idempotencyKey},
        ${track.url},
        ${track.title},
        ${JSON.stringify(track.lyrics)}::jsonb,
        ${metadata}::jsonb,
        now()
      from queue_state
      where queue_state.depth < ${config.target}
        and not exists (
          select 1
          from song_requests existing
          where existing.session_id = ${config.sessionId}::uuid
            and existing.metadata->>'houseTrackId' = ${track.id}
            and existing.status in ('queued', 'generating', 'ready')
        )
      returning id
      )
      select
        (select id from inserted) as id,
        (select depth from queue_state) as depth
    `);

    const row = result.rows[0];
    if (!row?.id) {
      return (row?.depth ?? 0) >= config.target
        ? { status: "at-target" }
        : { status: "taken" };
    }

    await recordEvent(row.id, "house_track_queued", {
      houseTrackId: track.id,
      title: track.title,
    });
    return { status: "created", id: row.id };
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