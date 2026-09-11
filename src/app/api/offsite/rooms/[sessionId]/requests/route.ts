import { z } from "zod";
import { and, eq } from "drizzle-orm";

import {
  requireRoomOperatorAccess,
  requireSameOrigin,
} from "@/lib/auth/room-operator";
import { json, parseBody, route } from "@/lib/api";
import { db } from "@/lib/db/client";
import {
  createSongRequest,
  hostNeedsApiKey,
} from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { enqueueGeneration } from "@/lib/enqueue";
import { AppError } from "@/lib/errors";
import { assertPromptAllowed, hashValue } from "@/lib/security";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ sessionId: string }> };

const requestSchema = z.object({
  prompt: z.string().trim().min(10).max(800),
  instrumental: z.boolean().optional().default(true),
});

/** Room-DJ authored track, implicitly approved regardless of request mode. */
export const POST = route(async (request: Request, context: Ctx) => {
  requireSameOrigin(request);
  const { sessionId } = await context.params;
  const principal = await requireRoomOperatorAccess(sessionId);
  const [room] = await db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.id, sessionId), eq(sessions.source, "integration"))
    )
    .limit(1);
  if (!room) {
    throw new AppError(404, "session_not_found", "Offsite room not found.");
  }
  if (!room.isActive) {
    throw new AppError(409, "session_ended", "This room has ended.");
  }
  if (await hostNeedsApiKey(room.hostId)) {
    throw new AppError(
      403,
      "host_key_missing",
      "The room's generation account needs an ElevenLabs key."
    );
  }

  const input = await parseBody(request, requestSchema, {
    message: "Invalid track prompt.",
  });
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8) {
    throw new AppError(
      400,
      "missing_idempotency_key",
      "Idempotency-Key is required for track generation."
    );
  }
  assertPromptAllowed(input.prompt);
  const result = await createSongRequest(
    room.id,
    {
      prompt: input.prompt,
      requesterName: principal.displayName.slice(0, 40),
      instrumental: input.instrumental,
    },
    hashValue(`room-operator:${principal.actorId}`, "ip"),
    {
      asOperator: true,
      idempotencyKey: hashValue(
        `${room.id}:${principal.actorId}:${idempotencyKey}`,
        "idempotency"
      ),
    }
  );
  const enqueue = result.replayed
    ? null
    : await enqueueGeneration(result.request.id);
  return json(
    {
      requestId: result.request.id,
      status: result.request.status,
      queuePosition: result.request.position,
      replayed: result.replayed,
      worker: enqueue?.mode ?? null,
    },
    { status: result.replayed ? 200 : 201 }
  );
});
