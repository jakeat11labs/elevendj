import { requirePlayerDevice } from "@/lib/auth/player";
import { json, route } from "@/lib/api";
import { getQueueSnapshot, heartbeatPlayer } from "@/lib/db";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const device = await requirePlayerDevice();
  await heartbeatPlayer(device.id);
  if (!device.sessionId) {
    throw new AppError(
      409,
      "unassigned",
      "This player is not assigned to a room yet."
    );
  }
  const queue = await getQueueSnapshot(device.sessionId);
  return json(queue);
});
