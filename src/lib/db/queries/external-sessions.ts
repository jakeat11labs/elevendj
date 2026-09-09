import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import type { SessionRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import type { IntegrationAgendaUpsert } from "@/lib/playback/contracts";
import { dbCall, mapSession, toIso } from "./internal";
import { hostNeedsApiKey } from "./users";
import { getQueueSnapshot } from "./playback";

export type ExternalSessionView = {
  id: string;
  externalSessionId: string;
  name: string;
  roomName: string | null;
  publicCode: string;
  requestUrl: string;
  isActive: boolean;
  requestsOpen: boolean;
  autoDj: boolean;
  agendaStartsAt: string | null;
  agendaEndsAt: string | null;
  externalRevision: string | null;
  source: "integration";
  readiness: {
    hostKeyReady: boolean;
  };
};

function siteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "http://localhost:3000"
  );
}

export function toExternalSessionView(
  row: SessionRow,
  hostKeyReady: boolean
): ExternalSessionView {
  return {
    id: row.id,
    externalSessionId: row.externalSessionId ?? "",
    name: row.name,
    roomName: row.roomName,
    publicCode: row.publicCode,
    requestUrl: `${siteOrigin()}/request?code=${encodeURIComponent(row.publicCode)}`,
    isActive: row.isActive,
    requestsOpen: row.requestsOpen,
    autoDj: row.autoDj,
    agendaStartsAt: toIso(row.agendaStartsAt),
    agendaEndsAt: toIso(row.agendaEndsAt),
    externalRevision: row.externalRevision,
    source: "integration",
    readiness: { hostKeyReady },
  };
}

export async function getExternalSession(
  clientId: string,
  externalSessionId: string
): Promise<SessionRow | null> {
  return dbCall(async () => {
    const [row] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.integrationClientId, clientId),
          eq(sessions.externalSessionId, externalSessionId)
        )
      )
      .limit(1);
    return row ?? null;
  });
}

export async function requireExternalSession(
  clientId: string,
  externalSessionId: string
): Promise<SessionRow> {
  const row = await getExternalSession(clientId, externalSessionId);
  if (!row) {
    throw new AppError(
      404,
      "session_not_found",
      "No agenda session matched that external id."
    );
  }
  return row;
}

export async function upsertExternalSession(input: {
  clientId: string;
  ownerHostId: string;
  externalSessionId: string;
  body: IntegrationAgendaUpsert;
}): Promise<ExternalSessionView> {
  return dbCall(async () => {
    const existing = await getExternalSession(
      input.clientId,
      input.externalSessionId
    );
    const state = input.body.state ?? "scheduled";
    const isActive = state !== "ended";
    const settings = input.body.settings ?? {};
    const startsAt = input.body.startsAt
      ? new Date(input.body.startsAt)
      : null;
    const endsAt = input.body.endsAt ? new Date(input.body.endsAt) : null;

    let row: SessionRow;
    if (existing) {
      const [updated] = await db
        .update(sessions)
        .set({
          name: input.body.title.trim().slice(0, 120),
          roomName: input.body.roomName?.trim() || null,
          externalRevision: input.body.revision ?? existing.externalRevision,
          agendaStartsAt: startsAt ?? existing.agendaStartsAt,
          agendaEndsAt: endsAt ?? existing.agendaEndsAt,
          externalMetadata: input.body.metadata ?? existing.externalMetadata,
          requestsOpen:
            settings.requestsOpen ??
            (isActive ? existing.requestsOpen : false),
          autoDj: settings.autoDj ?? existing.autoDj,
          defaultDurationMs:
            settings.defaultDurationMs ?? existing.defaultDurationMs,
          forceInstrumental:
            settings.forceInstrumental ?? existing.forceInstrumental,
          // Integration rooms keep station IDs off for the MVP.
          stationIdEnabled: false,
          isActive,
          endedAt: isActive ? null : existing.endedAt ?? new Date(),
          isPlaying: isActive ? existing.isPlaying : false,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, existing.id))
        .returning();
      row = updated;
    } else {
      const [created] = await db
        .insert(sessions)
        .values({
          name: input.body.title.trim().slice(0, 120) || "Offsite session",
          hostId: input.ownerHostId,
          source: "integration",
          integrationClientId: input.clientId,
          externalSessionId: input.externalSessionId,
          externalRevision: input.body.revision ?? null,
          roomName: input.body.roomName?.trim() || null,
          agendaStartsAt: startsAt,
          agendaEndsAt: endsAt,
          externalMetadata: input.body.metadata ?? {},
          requestsOpen: settings.requestsOpen ?? true,
          autoDj: settings.autoDj ?? true,
          defaultDurationMs: settings.defaultDurationMs ?? 60000,
          forceInstrumental: settings.forceInstrumental ?? true,
          stationIdEnabled: false,
          crossfadeEnabled: false,
          isActive,
          endedAt: isActive ? null : new Date(),
        })
        .returning();
      row = created;
    }

    const hostKeyReady = !(await hostNeedsApiKey(input.ownerHostId));
    return toExternalSessionView(row, hostKeyReady);
  });
}

export async function getExternalSessionStatus(
  clientId: string,
  externalSessionId: string
) {
  const row = await requireExternalSession(clientId, externalSessionId);
  const hostKeyReady = !(await hostNeedsApiKey(row.hostId));
  const queue = await getQueueSnapshot(row.id);
  const { listPlayerDevicesForSession } = await import("./player-devices");
  const { getRoomPlaybackState } = await import("./room-playback");
  const [players, playback] = await Promise.all([
    listPlayerDevicesForSession(row.id),
    getRoomPlaybackState(row.id),
  ]);

  return {
    session: toExternalSessionView(row, hostKeyReady),
    queue: {
      counts: queue.counts,
      itemCount: queue.items.length,
      requestsOpen: queue.requestsOpen,
    },
    playback,
    players,
  };
}

export async function listIntegrationSessions(clientId?: string) {
  return dbCall(async () => {
    const rows = clientId
      ? await db
          .select()
          .from(sessions)
          .where(
            and(
              eq(sessions.source, "integration"),
              eq(sessions.integrationClientId, clientId)
            )
          )
      : await db
          .select()
          .from(sessions)
          .where(eq(sessions.source, "integration"));
    return rows.map((row) => mapSession(row));
  });
}
