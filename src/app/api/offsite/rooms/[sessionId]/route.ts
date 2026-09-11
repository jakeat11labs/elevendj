import { z } from "zod";
import { and, eq } from "drizzle-orm";

import {
  requireRoomOperatorAccess,
  requireSameOrigin,
} from "@/lib/auth/room-operator";
import { json, parseBody, route } from "@/lib/api";
import { ensureAutoDjQueue } from "@/lib/autodj-pool";
import { db } from "@/lib/db/client";
import { applyPlaybackAction } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { playbackActionSchema } from "@/lib/integration/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sessionId: string }> };

async function requireRoom(sessionId: string) {
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
    throw new AppError(409, "session_ended", "This Offsite room has ended.");
  }
  return room;
}

/** Revision-safe transport and track selection. */
export const POST = route(async (request: Request, context: Ctx) => {
  requireSameOrigin(request);
  const { sessionId } = await context.params;
  const principal = await requireRoomOperatorAccess(sessionId);
  await requireRoom(sessionId);
  const action = await parseBody(request, playbackActionSchema, {
    message: "Invalid playback action.",
  });
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8) {
    throw new AppError(
      400,
      "missing_idempotency_key",
      "Idempotency-Key is required for playback."
    );
  }
  const playback = await applyPlaybackAction(
    sessionId,
    {
      type:
        principal.kind === "emergency"
          ? "offsite_emergency"
          : principal.kind === "operator"
            ? "offsite_operator"
            : "admin",
      id: principal.actorId,
      idempotencyKey,
    },
    action
  );
  return json({ playback });
});

const settingsSchema = z
  .object({
    requestsOpen: z.boolean().optional(),
    autoApprove: z.boolean().optional(),
    autoDjEnabled: z.boolean().optional(),
    autoDjBrief: z.string().trim().max(400).nullable().optional(),
    masterVolume: z.number().min(0).max(1).optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "No room setting provided.",
  });

/** Room-safe settings; no session, device, key, or user administration. */
export const PATCH = route(async (request: Request, context: Ctx) => {
  requireSameOrigin(request);
  const { sessionId } = await context.params;
  await requireRoomOperatorAccess(sessionId);
  await requireRoom(sessionId);
  const patch = await parseBody(request, settingsSchema, {
    message: "Invalid room settings.",
  });
  const values: Partial<typeof sessions.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.requestsOpen !== undefined) {
    values.requestsOpen = patch.requestsOpen;
  }
  if (patch.autoApprove !== undefined) {
    values.autoApprove = patch.autoApprove;
  }
  if (patch.autoDjEnabled !== undefined) {
    values.autoDjEnabled = patch.autoDjEnabled;
  }
  if (patch.autoDjBrief !== undefined) {
    values.autoDjBrief = patch.autoDjBrief?.trim() || null;
  }
  if (patch.masterVolume !== undefined) {
    values.masterVolume = patch.masterVolume;
  }

  await db.update(sessions).set(values).where(eq(sessions.id, sessionId));
  if (patch.autoDjEnabled) {
    void ensureAutoDjQueue(sessionId).catch((error) => {
      console.error("Operator AutoDJ warm-up failed", error);
    });
  }
  return json({ ok: true });
});
