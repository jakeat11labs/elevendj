import { z } from "zod";

import { requireAdmin } from "@/lib/auth/admin";
import { json, parseBody, route } from "@/lib/api";
import {
  applyPlaybackAction,
  getQueueSnapshot,
  getRoomPlaybackState,
  setRoomAutoDj,
} from "@/lib/db";
import { ensureAutoDjQueue } from "@/lib/autodj-pool";
import { playbackActionSchema } from "@/lib/integration/contracts";
import { AppError } from "@/lib/errors";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ sessionId: string }> };

export const GET = route(async (_request: Request, context: Ctx) => {
  await requireAdmin();
  const { sessionId } = await context.params;
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.id, sessionId), eq(sessions.source, "integration"))
    )
    .limit(1);
  if (!session) {
    throw new AppError(404, "session_not_found", "Offsite session not found.");
  }
  const [playback, queue] = await Promise.all([
    getRoomPlaybackState(session.id),
    getQueueSnapshot(session.id),
  ]);
  return json({
    session: {
      id: session.id,
      name: session.name,
      roomName: session.roomName,
      publicCode: session.publicCode,
      isActive: session.isActive,
    },
    playback,
    queue,
  });
});

const autoDjSchema = z
  .object({
    enabled: z.boolean().optional(),
    target: z.number().int().min(1).max(5).optional(),
    brief: z.string().trim().max(400).nullable().optional(),
    autoplay: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "No AutoDJ settings provided.",
  });

/** In-room AutoDJ override for an operator standing at the console. */
export const PATCH = route(async (request: Request, context: Ctx) => {
  await requireAdmin();
  const { sessionId } = await context.params;
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.source, "integration")))
    .limit(1);
  if (!session) {
    throw new AppError(404, "session_not_found", "Offsite session not found.");
  }

  const patch = await parseBody(request, autoDjSchema, {
    message: "Invalid AutoDJ settings.",
  });
  await setRoomAutoDj(session.id, patch);

  if (patch.enabled) {
    void ensureAutoDjQueue(session.id).catch((error) => {
      console.error("AutoDJ warm-up failed", error);
    });
  }

  return json({ ok: true });
});

export const POST = route(async (request: Request, context: Ctx) => {
  const admin = await requireAdmin();
  const { sessionId } = await context.params;
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(eq(sessions.id, sessionId), eq(sessions.source, "integration"))
    )
    .limit(1);
  if (!session) {
    throw new AppError(404, "session_not_found", "Offsite session not found.");
  }

  const idempotencyKey =
    request.headers.get("idempotency-key")?.trim() ||
    `admin-${admin.id}-${Date.now()}`;

  const action = await parseBody(request, playbackActionSchema, {
    message: "Invalid playback action.",
  });

  const playback = await applyPlaybackAction(
    sessionId,
    { type: "admin", id: admin.id, idempotencyKey },
    action
  );
  return json({ playback });
});
