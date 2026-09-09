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
import { runAutoDj } from "@/lib/autodj-pool";

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

  // A paired device polling is the only reliable signal an unattended offsite
  // room is live, so it doubles as the AutoDJ heartbeat: keep the room stocked
  // and start it if it's sitting silent. Best-effort — never block the player.
  if (session.autoDjEnabled) {
    void runAutoDj(session.id).catch((error) => {
      console.error("AutoDJ run failed", error);
    });
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
