import { and, desc, eq, inArray } from "drizzle-orm";

import { requireRoomOperatorScope } from "@/lib/auth/room-operator";
import { json, route } from "@/lib/api";
import { db } from "@/lib/db/client";
import {
  getQueueSnapshot,
  getRoomPlaybackState,
  listPlayerDevices,
} from "@/lib/db";
import { sessions, songRequests } from "@/lib/db/schema";
import { mapQueueItem } from "@/lib/db/queries/internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const scope = await requireRoomOperatorScope();
  const roomRows = scope.allRooms
    ? await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.source, "integration"),
            eq(sessions.isActive, true)
          )
        )
        .orderBy(desc(sessions.agendaStartsAt), desc(sessions.createdAt))
    : scope.roomIds.length > 0
      ? await db
          .select()
          .from(sessions)
          .where(
            and(
              inArray(sessions.id, scope.roomIds),
              eq(sessions.source, "integration"),
              eq(sessions.isActive, true)
            )
          )
          .orderBy(desc(sessions.agendaStartsAt), desc(sessions.createdAt))
      : [];

  const devices = await listPlayerDevices();
  const rooms = await Promise.all(
    roomRows.map(async (room) => {
      const [queue, playback, failedRows] = await Promise.all([
        getQueueSnapshot(room.id),
        getRoomPlaybackState(room.id),
        db
          .select()
          .from(songRequests)
          .where(
            and(
              eq(songRequests.sessionId, room.id),
              eq(songRequests.kind, "request"),
              eq(songRequests.status, "failed")
            )
          )
          .orderBy(desc(songRequests.createdAt))
          .limit(10),
      ]);
      return {
        id: room.id,
        name: room.name,
        roomName: room.roomName,
        externalSessionId: room.externalSessionId,
        isActive: room.isActive,
        requestsOpen: room.requestsOpen,
        autoApprove: room.autoApprove,
        autoDj: {
          enabled: room.autoDjEnabled,
          brief: room.autoDjBrief,
          target: room.autoDjTarget,
        },
        masterVolume: room.masterVolume,
        forceInstrumental: room.forceInstrumental,
        playback,
        queue: {
          ...queue,
          items: [...queue.items, ...failedRows.map(mapQueueItem)],
          counts: {
            ...queue.counts,
            failed: failedRows.length,
          },
        },
        players: devices
          .filter(
            (device) =>
              device.sessionId === room.id && device.status === "active"
          )
          .map((device) => ({
            id: device.id,
            name: device.name,
            online: device.online,
            audioUnlocked: device.audioUnlocked,
            lastError: device.lastError,
          })),
      };
    })
  );

  return json({
    operator: {
      kind: scope.principal.kind,
      displayName: scope.principal.displayName,
      roomScoped: !scope.allRooms && rooms.length <= 1,
    },
    rooms,
  });
});
