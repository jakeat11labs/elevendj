import { requirePlayerDevice } from "@/lib/auth/player";
import { json, route } from "@/lib/api";
import {
  getQueueSnapshot,
  getRoomPlaybackState,
  heartbeatPlayer,
} from "@/lib/db";
import { AppError } from "@/lib/errors";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const device = await requirePlayerDevice();
  await heartbeatPlayer(device.id);

  if (!device.sessionId) {
    return json({
      device: {
        id: device.id,
        name: device.name,
        sessionId: null,
        audioUnlocked: device.audioUnlocked,
      },
      session: null,
      playback: null,
      queue: null,
    });
  }

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, device.sessionId))
    .limit(1);
  if (!session) {
    throw new AppError(404, "session_not_found", "Assigned session not found.");
  }

  const [playback, queue] = await Promise.all([
    getRoomPlaybackState(session.id),
    getQueueSnapshot(session.id),
  ]);

  return json({
    device: {
      id: device.id,
      name: device.name,
      sessionId: device.sessionId,
      audioUnlocked: device.audioUnlocked,
    },
    session: {
      id: session.id,
      name: session.name,
      roomName: session.roomName,
      publicCode: session.publicCode,
      isActive: session.isActive,
      masterVolume: session.masterVolume,
      orbColorway: session.orbColorway,
      requestsOpen: session.requestsOpen,
    },
    playback,
    queue,
  });
});
