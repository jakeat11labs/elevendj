import { requirePlayerDevice } from "@/lib/auth/player";
import { json, parseBody, route } from "@/lib/api";
import { applyPlaybackAction } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { playbackActionSchema } from "@/lib/integration/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Player-originated actions (typically `ended`). Session is derived from the device. */
export const POST = route(async (request: Request) => {
  const device = await requirePlayerDevice();
  if (!device.sessionId) {
    throw new AppError(
      409,
      "unassigned",
      "This player is not assigned to a room yet."
    );
  }

  const idempotencyKey =
    request.headers.get("idempotency-key")?.trim() ||
    `player-${device.id}-${Date.now()}`;

  const action = await parseBody(request, playbackActionSchema, {
    message: "Invalid playback action.",
  });

  const playback = await applyPlaybackAction(
    device.sessionId,
    {
      type: "player",
      id: device.id,
      idempotencyKey,
    },
    action
  );

  return json({ playback });
});
