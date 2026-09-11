import { z } from "zod";
import { and, eq } from "drizzle-orm";

import {
  requireRoomOperatorAccess,
  requireSameOrigin,
} from "@/lib/auth/room-operator";
import { json, parseBody, route } from "@/lib/api";
import { db } from "@/lib/db/client";
import {
  approveOffsiteRequest,
  archiveOffsiteRequest,
  rejectOffsiteRequest,
  retryOffsiteRequest,
} from "@/lib/db";
import { sessions, songRequests } from "@/lib/db/schema";
import { enqueueGeneration } from "@/lib/enqueue";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = {
  params: Promise<{ sessionId: string; requestId: string }>;
};

const actionSchema = z.object({
  action: z.enum(["approve", "reject", "retry", "remove"]),
  reason: z.string().trim().max(200).optional(),
});

export const PATCH = route(async (request: Request, context: Ctx) => {
  requireSameOrigin(request);
  const { sessionId, requestId } = await context.params;
  await requireRoomOperatorAccess(sessionId);

  const [row] = await db
    .select({
      id: songRequests.id,
      currentRequestId: sessions.currentRequestId,
    })
    .from(songRequests)
    .innerJoin(sessions, eq(sessions.id, songRequests.sessionId))
    .where(
      and(
        eq(songRequests.id, requestId),
        eq(songRequests.sessionId, sessionId),
        eq(songRequests.kind, "request"),
        eq(sessions.source, "integration"),
        eq(sessions.isActive, true)
      )
    )
    .limit(1);
  if (!row) {
    throw new AppError(
      404,
      "request_not_found",
      "That track is not in this room."
    );
  }

  const { action, reason } = await parseBody(request, actionSchema, {
    message: "Invalid queue action.",
  });
  if (action === "remove" && row.currentRequestId === requestId) {
    throw new AppError(
      409,
      "track_playing",
      "Skip the current track before removing it."
    );
  }

  if (action === "approve") {
    await approveOffsiteRequest(sessionId, requestId);
    await enqueueGeneration(requestId);
  }
  if (action === "reject") {
    await rejectOffsiteRequest(
      sessionId,
      requestId,
      reason || "Rejected by room DJ."
    );
  }
  if (action === "retry") {
    await retryOffsiteRequest(sessionId, requestId);
    await enqueueGeneration(requestId);
  }
  if (action === "remove") {
    await archiveOffsiteRequest(sessionId, requestId);
  }

  return json({ ok: true });
});
