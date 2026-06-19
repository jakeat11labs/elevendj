import "server-only";

import { del } from "@vercel/blob";
import { and, count, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessions, songRequests } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { generateClientToken, hashValue, normalizePrompt } from "@/lib/security";
import type { RequestInput } from "@/lib/security";
import type { QueueItem, RequestStatus } from "@/lib/status";
import { activeStatuses, dbCall, mapQueueItem, ownedSessionIds, recordEvent, toRecord } from "./internal";
import type { SongRequestRecord } from "./internal";
import { getActiveSessionForHost } from "./sessions";


// ─────────────────────────────────────────────────────────────────
// Request creation (public by code / host-authored)
// ─────────────────────────────────────────────────────────────────

export async function createSongRequest(
  sessionId: string,
  input: RequestInput,
  ipHash: string,
  options: { asHost?: boolean } = {}
) {
  return dbCall(async () => {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!session) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }

    // The host can spin a track even while the public line is paused.
    if (!options.asHost && !session.requestsOpen) {
      throw new AppError(403, "requests_closed", "The request line is closed.");
    }

    // Per-connection rate limit guards the public form (per session); the
    // authenticated host is trusted and exempt.
    if (!options.asHost) {
      const since = new Date(Date.now() - 10 * 60 * 1000);
      const [{ value: recentCount }] = await db
        .select({ value: count() })
        .from(songRequests)
        .where(
          and(
            eq(songRequests.sessionId, session.id),
            eq(songRequests.ipHash, ipHash),
            gte(songRequests.createdAt, since)
          )
        );
      if ((recentCount ?? 0) >= 3) {
        throw new AppError(
          429,
          "rate_limited",
          "Too many requests from this connection. Wait a few minutes before sending another."
        );
      }
    }

    const [{ value: activeCount }] = await db
      .select({ value: count() })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, session.id),
          eq(songRequests.kind, "request"),
          inArray(songRequests.status, activeStatuses)
        )
      );

    if ((activeCount ?? 0) >= session.maxPendingRequests) {
      throw new AppError(
        409,
        "queue_full",
        "The queue is full right now. Try again after the next track starts."
      );
    }

    const normalizedPrompt = normalizePrompt(input.prompt);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [duplicate] = await db
      .select({ id: songRequests.id })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, session.id),
          eq(songRequests.kind, "request"),
          eq(songRequests.normalizedPrompt, normalizedPrompt),
          inArray(songRequests.status, activeStatuses),
          gte(songRequests.createdAt, dayAgo)
        )
      )
      .limit(1);

    if (duplicate) {
      throw new AppError(
        409,
        "duplicate_prompt",
        "That request is already in the queue."
      );
    }

    const [lastPosition] = await db
      .select({ position: songRequests.position })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, session.id),
          isNotNull(songRequests.position)
        )
      )
      .orderBy(desc(songRequests.position))
      .limit(1);

    const clientToken = generateClientToken();
    const tokenHash = hashValue(clientToken, "client-token");
    const nextPosition = Number(lastPosition?.position ?? 0) + 1;

    // AutoDJ generates immediately (`queued`); approval mode holds the request
    // in `pending`. A host-authored track is implicitly approved.
    const initialStatus: RequestStatus =
      options.asHost || session.autoDj ? "queued" : "pending";

    const [created] = await db
      .insert(songRequests)
      .values({
        sessionId: session.id,
        clientTokenHash: tokenHash,
        requesterName: input.requesterName ?? null,
        prompt: input.prompt,
        normalizedPrompt,
        status: initialStatus,
        position: nextPosition,
        durationMs: session.defaultDurationMs,
        forceInstrumental: input.instrumental ?? false,
        ipHash,
        idempotencyKey: hashValue(
          `${ipHash}:${normalizedPrompt}:${Date.now()}`,
          "idempotency"
        ),
      })
      .returning();

    await recordEvent(created.id, "request_created", { position: nextPosition });

    return { request: toRecord(created), clientToken };
  });
}


export async function getRequestByClientToken(id: string, clientToken: string) {
  return dbCall(async () => {
    const tokenHash = hashValue(clientToken, "client-token");
    const [row] = await db
      .select()
      .from(songRequests)
      .where(
        and(
          eq(songRequests.id, id),
          eq(songRequests.clientTokenHash, tokenHash)
        )
      )
      .limit(1);

    if (!row) {
      throw new AppError(404, "request_not_found", "No request matched that token.");
    }
    return mapQueueItem(row);
  });
}


export async function approveRequest(
  hostId: string,
  id: string
): Promise<SongRequestRecord | null> {
  return dbCall(async () => {
    const [row] = await db
      .update(songRequests)
      .set({
        status: "queued",
        errorCode: null,
        errorMessage: null,
        promptSuggestion: null,
      })
      .where(
        and(
          eq(songRequests.id, id),
          eq(songRequests.status, "pending"),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      )
      .returning();

    if (!row) {
      return null;
    }
    await recordEvent(id, "request_approved", {});
    return toRecord(row);
  });
}


export async function rejectRequest(
  hostId: string,
  id: string,
  reason = "Rejected by DJ."
) {
  await dbCall(async () => {
    await db
      .update(songRequests)
      .set({
        status: "rejected",
        errorCode: "admin_rejected",
        errorMessage: reason,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      );
    await recordEvent(id, "request_rejected", { reason });
  });
}


export async function requeueRequest(hostId: string, id: string) {
  await dbCall(async () => {
    // Grab the current audio first (host-scoped) so we can drop the stale blob
    // after clearing the row.
    const [existing] = await db
      .select({ audioUrl: songRequests.audioUrl })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      )
      .limit(1);

    await db
      .update(songRequests)
      .set({
        status: "queued",
        audioUrl: null,
        blobPath: null,
        songId: null,
        title: null,
        isExplicit: false,
        errorCode: null,
        errorMessage: null,
        promptSuggestion: null,
        completedAt: null,
        startedAt: null,
      })
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      );

    // Delete the now-unreferenced blob so a requeued-but-not-yet-regenerated
    // track doesn't leave an orphan behind. Best-effort — a missing blob must
    // not block the requeue. Regeneration writes the same deterministic path.
    if (existing?.audioUrl) {
      try {
        await del(existing.audioUrl);
      } catch (error) {
        console.error("Failed to delete stale blob on requeue", error);
      }
    }

    await recordEvent(id, "request_requeued", {});
  });
}


export async function markRequestPlayed(hostId: string, id: string) {
  await dbCall(async () => {
    await db
      .update(songRequests)
      .set({ status: "played" })
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      );
    await recordEvent(id, "request_played", {});
  });
}


export async function removeFromQueue(
  hostId: string,
  id: string
): Promise<QueueItem> {
  return dbCall(async () => {
    const [row] = await db
      .update(songRequests)
      .set({ status: "archived", position: null })
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      )
      .returning();
    if (!row) {
      throw new AppError(404, "request_not_found", "Request not found.");
    }
    await recordEvent(id, "request_archived", {});
    return mapQueueItem(row);
  });
}


export async function addToQueue(hostId: string, id: string): Promise<QueueItem> {
  return dbCall(async () => {
    // Locate the request (host-scoped) so we can compute its session's next slot.
    const [target] = await db
      .select()
      .from(songRequests)
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      )
      .limit(1);
    if (!target) {
      throw new AppError(404, "request_not_found", "Request not found.");
    }

    const [maxPosition] = await db
      .select({ position: songRequests.position })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, target.sessionId),
          eq(songRequests.status, "ready"),
          isNotNull(songRequests.position)
        )
      )
      .orderBy(desc(songRequests.position))
      .limit(1);

    const nextPosition = Number(maxPosition?.position ?? 0) + 1;

    const [row] = await db
      .update(songRequests)
      .set({ status: "ready", position: nextPosition })
      .where(eq(songRequests.id, id))
      .returning();

    await recordEvent(id, "request_queued", { position: nextPosition });
    return mapQueueItem(row);
  });
}


export async function deleteRequest(
  hostId: string,
  id: string
): Promise<{ ok: true }> {
  return dbCall(async () => {
    const [row] = await db
      .select({ audioUrl: songRequests.audioUrl })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      )
      .limit(1);
    if (!row) {
      throw new AppError(404, "request_not_found", "Request not found.");
    }

    if (row.audioUrl) {
      await del(row.audioUrl);
    }

    await db.delete(songRequests).where(eq(songRequests.id, id));
    return { ok: true };
  });
}


export async function reorderQueue(
  hostId: string,
  orderedIds: string[]
): Promise<void> {
  await dbCall(async () => {
    for (let i = 0; i < orderedIds.length; i += 1) {
      await db
        .update(songRequests)
        .set({ position: i + 1 })
        .where(
          and(
            eq(songRequests.id, orderedIds[i]),
            inArray(songRequests.sessionId, ownedSessionIds(hostId))
          )
        );
    }
  });
}


export async function listFiles(
  hostId: string,
  sessionId?: string
): Promise<QueueItem[]> {
  return dbCall(async () => {
    const ownedFilter = inArray(songRequests.sessionId, ownedSessionIds(hostId));

    let whereClause = and(ownedFilter, isNotNull(songRequests.audioUrl));
    if (sessionId && sessionId !== "all") {
      whereClause = and(whereClause, eq(songRequests.sessionId, sessionId));
    } else if (!sessionId) {
      const active = await getActiveSessionForHost(hostId);
      whereClause = and(whereClause, eq(songRequests.sessionId, active.id));
    }

    const rows = await db
      .select()
      .from(songRequests)
      .where(whereClause)
      .orderBy(desc(songRequests.createdAt));

    return rows.map(mapQueueItem);
  });
}


export async function bulkAction(
  hostId: string,
  action: "delete" | "remove_from_queue" | "add_to_queue",
  ids: string[]
): Promise<number> {
  let processed = 0;
  for (const id of ids) {
    if (action === "delete") {
      await deleteRequest(hostId, id);
    } else if (action === "remove_from_queue") {
      await removeFromQueue(hostId, id);
    } else {
      await addToQueue(hostId, id);
    }
    processed += 1;
  }
  return processed;
}
