import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { songRequests } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { dbCall, recordEvent, toRecord } from "./internal";

export async function approveOffsiteRequest(
  sessionId: string,
  requestId: string
) {
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
          eq(songRequests.id, requestId),
          eq(songRequests.sessionId, sessionId),
          eq(songRequests.status, "pending")
        )
      )
      .returning();
    if (!row) {
      throw new AppError(
        404,
        "request_not_found",
        "Pending track not found in this room."
      );
    }
    await recordEvent(requestId, "request_approved", {
      actor: "offsite_operator",
    });
    return toRecord(row);
  });
}

export async function rejectOffsiteRequest(
  sessionId: string,
  requestId: string,
  reason: string
): Promise<void> {
  await dbCall(async () => {
    const [row] = await db
      .update(songRequests)
      .set({
        status: "rejected",
        errorCode: "operator_rejected",
        errorMessage: reason,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(songRequests.id, requestId),
          eq(songRequests.sessionId, sessionId),
          eq(songRequests.kind, "request")
        )
      )
      .returning({ id: songRequests.id });
    if (!row) {
      throw new AppError(
        404,
        "request_not_found",
        "Track not found in this room."
      );
    }
    await recordEvent(requestId, "request_rejected", {
      reason,
      actor: "offsite_operator",
    });
  });
}

export async function retryOffsiteRequest(
  sessionId: string,
  requestId: string
): Promise<void> {
  await dbCall(async () => {
    const [row] = await db
      .update(songRequests)
      .set({
        status: "queued",
        errorCode: null,
        errorMessage: null,
        promptSuggestion: null,
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(songRequests.id, requestId),
          eq(songRequests.sessionId, sessionId),
          inArray(songRequests.status, ["failed", "rejected"])
        )
      )
      .returning({ id: songRequests.id });
    if (!row) {
      throw new AppError(
        404,
        "request_not_found",
        "Failed track not found in this room."
      );
    }
    await recordEvent(requestId, "request_requeued", {
      actor: "offsite_operator",
    });
  });
}

export async function archiveOffsiteRequest(
  sessionId: string,
  requestId: string
): Promise<void> {
  await dbCall(async () => {
    const [row] = await db
      .update(songRequests)
      .set({
        status: "archived",
        position: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(songRequests.id, requestId),
          eq(songRequests.sessionId, sessionId),
          eq(songRequests.kind, "request")
        )
      )
      .returning({ id: songRequests.id });
    if (!row) {
      throw new AppError(
        404,
        "request_not_found",
        "Track not found in this room."
      );
    }
    await recordEvent(requestId, "request_archived", {
      actor: "offsite_operator",
    });
  });
}

/**
 * Atomically reject cross-room/unknown IDs and apply the order. The update runs
 * only when every supplied id is an active request in this room.
 */
export async function reorderOffsiteQueue(
  sessionId: string,
  orderedIds: string[]
): Promise<void> {
  if (orderedIds.length === 0) return;
  await dbCall(async () => {
    const result = await db.execute<{ id: string }>(sql`
      with input(id, ord) as (
        select id, ord
        from unnest(${orderedIds}::uuid[]) with ordinality as t(id, ord)
      ),
      valid as (
        select count(*)::int as count
        from input i
        join song_requests r on r.id = i.id
        where r.session_id = ${sessionId}::uuid
          and r.kind = 'request'
          and r.status = 'ready'
      )
      update song_requests r
      set position = i.ord::int, updated_at = now()
      from input i, valid v
      where r.id = i.id
        and r.session_id = ${sessionId}::uuid
        and v.count = (select count(*) from input)
      returning r.id
    `);
    if (result.rows.length !== orderedIds.length) {
      throw new AppError(
        400,
        "invalid_queue_order",
        "Every reordered track must be active in this room."
      );
    }
  });
}
