import "server-only";

import { and, count, desc, eq, gte, sql } from "drizzle-orm";

import {
  issuePairingDisplayCode,
  issuePlayerCredential,
} from "@/lib/auth/credentials";
import { db } from "@/lib/db/client";
import { playerDevices, playerPairings, sessions } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { PLAYER_OFFLINE_AFTER_MS } from "@/lib/playback/timeline";
import type { PlayerStatusReport as Report } from "@/lib/playback/contracts";
import { dbCall, toIso } from "./internal";

export type PlayerPairingView = {
  id: string;
  displayCode: string;
  deviceName: string;
  status: string;
  sessionId: string | null;
  expiresAt: string;
  createdAt: string;
};

export type PlayerDeviceView = {
  id: string;
  name: string;
  sessionId: string | null;
  status: string;
  pairedAt: string;
  lastSeenAt: string | null;
  online: boolean;
  audioUnlocked: boolean;
  reportedRequestId: string | null;
  reportedRevision: number | null;
  reportedIsPlaying: boolean | null;
  reportedPositionMs: number | null;
  lastError: string | null;
  reportedAt: string | null;
};

function isOnline(lastSeenAt: Date | string | null): boolean {
  if (!lastSeenAt) return false;
  const ms =
    lastSeenAt instanceof Date
      ? lastSeenAt.getTime()
      : new Date(lastSeenAt).getTime();
  return Date.now() - ms < PLAYER_OFFLINE_AFTER_MS;
}

function mapDevice(
  row: typeof playerDevices.$inferSelect
): PlayerDeviceView {
  return {
    id: row.id,
    name: row.name,
    sessionId: row.sessionId,
    status: row.status,
    pairedAt: toIso(row.pairedAt) as string,
    lastSeenAt: toIso(row.lastSeenAt),
    online: isOnline(row.lastSeenAt),
    audioUnlocked: row.audioUnlocked,
    reportedRequestId: row.reportedRequestId,
    reportedRevision: row.reportedRevision,
    reportedIsPlaying: row.reportedIsPlaying,
    reportedPositionMs: row.reportedPositionMs,
    lastError: row.lastError,
    reportedAt: toIso(row.reportedAt),
  };
}

export async function createPlayerPairing(input: {
  deviceName: string;
  ipHash: string;
}): Promise<{
  pairing: PlayerPairingView;
  secret: string;
}> {
  return dbCall(async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const [{ value: recent }] = await db
      .select({ value: count() })
      .from(playerPairings)
      .where(
        and(
          eq(playerPairings.ipHash, input.ipHash),
          gte(playerPairings.createdAt, since)
        )
      );
    if ((recent ?? 0) >= 5) {
      throw new AppError(
        429,
        "rate_limited",
        "Too many pairing attempts from this connection. Try again later."
      );
    }

    const cred = issuePlayerCredential();
    let displayCode = issuePairingDisplayCode();
    // Retry a few times if the pending display code collides.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        const [row] = await db
          .insert(playerPairings)
          .values({
            displayCode,
            credentialHash: cred.hash,
            credentialPrefix: cred.prefix,
            deviceName: input.deviceName.trim().slice(0, 60) || "Stage player",
            ipHash: input.ipHash,
            status: "pending",
            expiresAt,
          })
          .returning();
        return {
          pairing: {
            id: row.id,
            displayCode: row.displayCode,
            deviceName: row.deviceName,
            status: row.status,
            sessionId: row.sessionId,
            expiresAt: toIso(row.expiresAt) as string,
            createdAt: toIso(row.createdAt) as string,
          },
          secret: cred.secret,
        };
      } catch {
        displayCode = issuePairingDisplayCode();
      }
    }
    throw new AppError(
      500,
      "pairing_failed",
      "Could not create a pairing code. Try again."
    );
  });
}

export async function getPlayerPairingStatus(
  pairingId: string,
  secret: string
): Promise<{
  status: string;
  deviceId?: string;
  sessionId?: string | null;
  approved?: boolean;
}> {
  return dbCall(async () => {
    const { verifyCredential } = await import("@/lib/auth/credentials");
    const [pairing] = await db
      .select()
      .from(playerPairings)
      .where(eq(playerPairings.id, pairingId))
      .limit(1);
    if (!pairing || !verifyCredential(secret, pairing.credentialHash)) {
      throw new AppError(404, "not_found", "Pairing not found.");
    }

    if (pairing.status === "pending" && pairing.expiresAt < new Date()) {
      await db
        .update(playerPairings)
        .set({ status: "expired", decidedAt: new Date() })
        .where(eq(playerPairings.id, pairing.id));
      return { status: "expired" };
    }

    if (pairing.status !== "approved") {
      return { status: pairing.status };
    }

    const [device] = await db
      .select()
      .from(playerDevices)
      .where(eq(playerDevices.pairingId, pairing.id))
      .limit(1);

    return {
      status: "approved",
      approved: true,
      deviceId: device?.id,
      sessionId: device?.sessionId ?? pairing.sessionId,
    };
  });
}

export async function listPendingPairings(): Promise<PlayerPairingView[]> {
  return dbCall(async () => {
    // Expire stale pending rows opportunistically.
    await db
      .update(playerPairings)
      .set({ status: "expired", decidedAt: new Date() })
      .where(
        and(
          eq(playerPairings.status, "pending"),
          sql`${playerPairings.expiresAt} < now()`
        )
      );

    const rows = await db
      .select()
      .from(playerPairings)
      .where(eq(playerPairings.status, "pending"))
      .orderBy(desc(playerPairings.createdAt));
    return rows.map((row) => ({
      id: row.id,
      displayCode: row.displayCode,
      deviceName: row.deviceName,
      status: row.status,
      sessionId: row.sessionId,
      expiresAt: toIso(row.expiresAt) as string,
      createdAt: toIso(row.createdAt) as string,
    }));
  });
}

export async function approvePlayerPairing(input: {
  pairingId: string;
  sessionId: string | null;
  approvedBy: string;
}): Promise<PlayerDeviceView> {
  return dbCall(async () => {
    const [pairing] = await db
      .select()
      .from(playerPairings)
      .where(eq(playerPairings.id, input.pairingId))
      .limit(1);
    if (!pairing) {
      throw new AppError(404, "not_found", "Pairing not found.");
    }
    if (pairing.status !== "pending") {
      throw new AppError(409, "pairing_closed", "This pairing is no longer pending.");
    }
    if (pairing.expiresAt < new Date()) {
      await db
        .update(playerPairings)
        .set({ status: "expired", decidedAt: new Date() })
        .where(eq(playerPairings.id, pairing.id));
      throw new AppError(410, "pairing_expired", "This pairing code has expired.");
    }

    if (input.sessionId) {
      const [session] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);
      if (!session) {
        throw new AppError(404, "session_not_found", "Session not found.");
      }
    }

    await db
      .update(playerPairings)
      .set({
        status: "approved",
        sessionId: input.sessionId,
        approvedBy: input.approvedBy,
        decidedAt: new Date(),
      })
      .where(eq(playerPairings.id, pairing.id));

    const [device] = await db
      .insert(playerDevices)
      .values({
        pairingId: pairing.id,
        sessionId: input.sessionId,
        name: pairing.deviceName,
        credentialHash: pairing.credentialHash,
        credentialPrefix: pairing.credentialPrefix,
        status: "active",
        pairedBy: input.approvedBy,
        lastSeenAt: new Date(),
      })
      .returning();

    return mapDevice(device);
  });
}

export async function rejectPlayerPairing(pairingId: string, rejectedBy: string) {
  return dbCall(async () => {
    const [row] = await db
      .update(playerPairings)
      .set({
        status: "rejected",
        approvedBy: rejectedBy,
        decidedAt: new Date(),
      })
      .where(
        and(
          eq(playerPairings.id, pairingId),
          eq(playerPairings.status, "pending")
        )
      )
      .returning();
    if (!row) {
      throw new AppError(404, "not_found", "Pending pairing not found.");
    }
    return { ok: true as const };
  });
}

export async function listPlayerDevices(): Promise<PlayerDeviceView[]> {
  return dbCall(async () => {
    const rows = await db
      .select()
      .from(playerDevices)
      .orderBy(desc(playerDevices.pairedAt));
    return rows.map(mapDevice);
  });
}

export async function listPlayerDevicesForSession(
  sessionId: string
): Promise<PlayerDeviceView[]> {
  return dbCall(async () => {
    const rows = await db
      .select()
      .from(playerDevices)
      .where(
        and(
          eq(playerDevices.sessionId, sessionId),
          eq(playerDevices.status, "active")
        )
      );
    return rows.map(mapDevice);
  });
}

export async function assignPlayerDevice(
  deviceId: string,
  sessionId: string | null
): Promise<PlayerDeviceView> {
  return dbCall(async () => {
    if (sessionId) {
      const [session] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);
      if (!session) {
        throw new AppError(404, "session_not_found", "Session not found.");
      }
    }
    const [row] = await db
      .update(playerDevices)
      .set({ sessionId, updatedAt: new Date() })
      .where(
        and(
          eq(playerDevices.id, deviceId),
          eq(playerDevices.status, "active")
        )
      )
      .returning();
    if (!row) {
      throw new AppError(404, "not_found", "Player device not found.");
    }
    return mapDevice(row);
  });
}

export async function revokePlayerDevice(deviceId: string): Promise<{ ok: true }> {
  return dbCall(async () => {
    const [row] = await db
      .update(playerDevices)
      .set({
        status: "revoked",
        sessionId: null,
        updatedAt: new Date(),
      })
      .where(eq(playerDevices.id, deviceId))
      .returning();
    if (!row) {
      throw new AppError(404, "not_found", "Player device not found.");
    }
    return { ok: true as const };
  });
}

export async function reportPlayerStatus(
  deviceId: string,
  report: Report
): Promise<PlayerDeviceView> {
  return dbCall(async () => {
    const [row] = await db
      .update(playerDevices)
      .set({
        lastSeenAt: new Date(),
        reportedRequestId: report.requestId,
        reportedRevision: report.revision,
        reportedIsPlaying: report.isPlaying,
        reportedPositionMs: report.positionMs,
        audioUnlocked: report.audioUnlocked,
        lastError: report.error ?? null,
        reportedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(playerDevices.id, deviceId),
          eq(playerDevices.status, "active")
        )
      )
      .returning();
    if (!row) {
      throw new AppError(404, "not_found", "Player device not found.");
    }
    return mapDevice(row);
  });
}

export async function heartbeatPlayer(deviceId: string): Promise<void> {
  await dbCall(async () => {
    await db
      .update(playerDevices)
      .set({ lastSeenAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(playerDevices.id, deviceId),
          eq(playerDevices.status, "active")
        )
      );
  });
}
