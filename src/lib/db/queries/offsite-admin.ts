import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { hostNeedsApiKey } from "./users";
import { getQueueSnapshot } from "./playback";
import { listIntegrationClients } from "./integrations";
import {
  listPendingPairings,
  listPlayerDevices,
} from "./player-devices";
import { getRoomPlaybackState } from "./room-playback";
import { dbCall, mapSession, toIso } from "./internal";

export type OffsiteRoomOverview = {
  id: string;
  name: string;
  roomName: string | null;
  publicCode: string;
  externalSessionId: string | null;
  integrationClientId: string | null;
  isActive: boolean;
  requestsOpen: boolean;
  agendaStartsAt: string | null;
  agendaEndsAt: string | null;
  hostKeyReady: boolean;
  queue: {
    counts: Record<string, number>;
    itemCount: number;
  };
  playback: Awaited<ReturnType<typeof getRoomPlaybackState>>;
  players: Awaited<ReturnType<typeof listPlayerDevices>>;
};

/** Superadmin Offsite console snapshot. */
export async function getOffsiteOverview() {
  return dbCall(async () => {
    const [clients, pendingPairings, devices, sessionRows] = await Promise.all([
      listIntegrationClients(),
      listPendingPairings(),
      listPlayerDevices(),
      db
        .select()
        .from(sessions)
        .where(eq(sessions.source, "integration"))
        .orderBy(desc(sessions.agendaStartsAt), desc(sessions.createdAt)),
    ]);

    const rooms: OffsiteRoomOverview[] = [];
    for (const row of sessionRows) {
      const [queue, playback, hostKeyMissing] = await Promise.all([
        getQueueSnapshot(row.id),
        getRoomPlaybackState(row.id),
        hostNeedsApiKey(row.hostId),
      ]);
      rooms.push({
        id: row.id,
        name: row.name,
        roomName: row.roomName,
        publicCode: row.publicCode,
        externalSessionId: row.externalSessionId,
        integrationClientId: row.integrationClientId,
        isActive: row.isActive,
        requestsOpen: row.requestsOpen,
        agendaStartsAt: toIso(row.agendaStartsAt),
        agendaEndsAt: toIso(row.agendaEndsAt),
        hostKeyReady: !hostKeyMissing,
        queue: {
          counts: queue.counts,
          itemCount: queue.items.length,
        },
        playback,
        players: devices.filter(
          (d) => d.sessionId === row.id && d.status === "active"
        ),
      });
    }

    return {
      clients,
      pendingPairings,
      devices,
      rooms,
      sessions: sessionRows.map((row) => mapSession(row)),
    };
  });
}

export async function listActiveIntegrationSessionsForAssign() {
  return dbCall(async () => {
    const rows = await db
      .select()
      .from(sessions)
      .where(
        and(eq(sessions.source, "integration"), eq(sessions.isActive, true))
      )
      .orderBy(desc(sessions.agendaStartsAt), desc(sessions.createdAt));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      roomName: row.roomName,
      publicCode: row.publicCode,
      externalSessionId: row.externalSessionId,
    }));
  });
}
