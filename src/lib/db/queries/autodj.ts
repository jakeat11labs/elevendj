import "server-only";

import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";

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

/**
 * Playable depth ahead of the room: tracks already ready or on their way,
 * whoever asked for them. Human requests count, so a busy room never has
 * AutoDJ talking over it. `pending` is excluded — it may never be approved.
 */
export async function countQueueDepth(sessionId: string): Promise<number> {
  return dbCall(async () => {
    const [{ value }] = await db
      .select({ value: count() })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, sessionId),
          eq(songRequests.kind, "request"),
          inArray(songRequests.status, ["queued", "generating", "ready"])
        )
      );
    return value ?? 0;
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

    const [lastPosition] = await db
      .select({ position: songRequests.position })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, config.sessionId),
          isNotNull(songRequests.position)
        )
      )
      .orderBy(desc(songRequests.position))
      .limit(1);

    // Unique per call so neither the idempotency key nor the duplicate-prompt
    // guard can collide when a pass inserts several tracks at once.
    const stamp = randomUUID();
    const [created] = await db
      .insert(songRequests)
      .values({
        sessionId: config.sessionId,
        clientTokenHash: hashValue(`autodj:${config.sessionId}`, "client-token"),
        requesterName: AUTODJ_CREDIT,
        source: "auto",
        kind: "request",
        prompt,
        normalizedPrompt: `${normalizePrompt(prompt)}:${stamp}`,
        status: "queued",
        position: (lastPosition?.position ?? 0) + 1,
        durationMs: config.durationMs,
        forceInstrumental: config.forceInstrumental,
        idempotencyKey: hashValue(
          `autodj:${config.sessionId}:${stamp}`,
          "idempotency"
        ),
      })
      .returning({ id: songRequests.id });

    await recordEvent(created.id, "autodj_created", { prompt });
    return created.id;
  });
}