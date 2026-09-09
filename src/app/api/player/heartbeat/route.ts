import { z } from "zod";

import { requirePlayerDevice } from "@/lib/auth/player";
import { json, parseBody, route } from "@/lib/api";
import { heartbeatPlayer, reportPlayerStatus } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  requestId: z.string().uuid().nullable(),
  revision: z.number().int().nonnegative(),
  isPlaying: z.boolean(),
  positionMs: z.number().int().nonnegative(),
  audioUnlocked: z.boolean(),
  error: z.string().max(500).nullable().optional(),
});

export const POST = route(async (request: Request) => {
  const device = await requirePlayerDevice();
  const body = await parseBody(request, schema, {
    message: "Invalid heartbeat payload.",
  });
  const view = await reportPlayerStatus(device.id, {
    requestId: body.requestId,
    revision: body.revision,
    isPlaying: body.isPlaying,
    positionMs: body.positionMs,
    audioUnlocked: body.audioUnlocked,
    error: body.error ?? null,
  });
  return json({ ok: true, device: view });
});

/** Lightweight presence ping without full status. */
export const PUT = route(async () => {
  const device = await requirePlayerDevice();
  await heartbeatPlayer(device.id);
  return json({ ok: true });
});
