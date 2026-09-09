import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { dbCall } from "./internal";
import { getActiveSessionForHost } from "./sessions";


// ─────────────────────────────────────────────────────────────────
// Per-session settings (host-scoped)
// ─────────────────────────────────────────────────────────────────

export async function setRequestsOpen(
  hostId: string,
  open: boolean
): Promise<void> {
  await dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    await db
      .update(sessions)
      .set({ requestsOpen: open })
      .where(and(eq(sessions.id, active.id), eq(sessions.hostId, hostId)));
  });
}


export async function setAutoApprove(
  hostId: string,
  autoApprove: boolean
): Promise<void> {
  await dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    await db
      .update(sessions)
      .set({ autoApprove })
      .where(and(eq(sessions.id, active.id), eq(sessions.hostId, hostId)));
  });
}


// ─────────────────────────────────────────────────────────────────
// AutoDJ — self-generating queue (see src/lib/autodj.ts)
// ─────────────────────────────────────────────────────────────────

export async function setAutoDjEnabled(
  hostId: string,
  enabled: boolean
): Promise<void> {
  await dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    await db
      .update(sessions)
      .set({ autoDjEnabled: enabled })
      .where(and(eq(sessions.id, active.id), eq(sessions.hostId, hostId)));
  });
}


export async function setAutoDjBrief(
  hostId: string,
  brief: string | null
): Promise<void> {
  await dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    const trimmed = brief?.trim();
    await db
      .update(sessions)
      .set({ autoDjBrief: trimmed ? trimmed : null })
      .where(and(eq(sessions.id, active.id), eq(sessions.hostId, hostId)));
  });
}


// Host-controlled room master volume (0..1). Caller (settings API) validates
// the range before this runs; the DB check constraint is the backstop.
export async function setMasterVolume(
  hostId: string,
  volume: number
): Promise<void> {
  await dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    await db
      .update(sessions)
      .set({ masterVolume: volume })
      .where(and(eq(sessions.id, active.id), eq(sessions.hostId, hostId)));
  });
}


// Caller (settings API) validates `colorway` against the colorway registry
// allowlist before this runs, so only a known name reaches the DB.
export async function setOrbColorway(
  hostId: string,
  colorway: string
): Promise<void> {
  await dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    await db
      .update(sessions)
      .set({ orbColorway: colorway })
      .where(and(eq(sessions.id, active.id), eq(sessions.hostId, hostId)));
  });
}


// ─────────────────────────────────────────────────────────────────
// Station ID settings + warm pool (see src/lib/station-id.ts)
// ─────────────────────────────────────────────────────────────────

export async function setStationIdEnabled(
  hostId: string,
  enabled: boolean
): Promise<void> {
  await dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    await db
      .update(sessions)
      .set({ stationIdEnabled: enabled })
      .where(and(eq(sessions.id, active.id), eq(sessions.hostId, hostId)));
  });
}


export async function setCrossfadeEnabled(
  hostId: string,
  enabled: boolean
): Promise<void> {
  await dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    await db
      .update(sessions)
      .set({ crossfadeEnabled: enabled })
      .where(and(eq(sessions.id, active.id), eq(sessions.hostId, hostId)));
  });
}


export async function setStationIdPersonalize(
  hostId: string,
  personalize: boolean
): Promise<void> {
  await dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    await db
      .update(sessions)
      .set({ stationIdPersonalize: personalize })
      .where(and(eq(sessions.id, active.id), eq(sessions.hostId, hostId)));
  });
}


export async function setStationIdHostName(
  hostId: string,
  name: string | null
): Promise<void> {
  await dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    const trimmed = name?.trim();
    await db
      .update(sessions)
      .set({ stationIdHostName: trimmed ? trimmed : null })
      .where(and(eq(sessions.id, active.id), eq(sessions.hostId, hostId)));
  });
}
