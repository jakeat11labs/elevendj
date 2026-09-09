import "server-only";

import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessions, songRequests, users } from "@/lib/db/schema";
import type { UserRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { dbCall, ownedSessionIds, toIso } from "./internal";
import type { HostSession } from "./internal";
import { listSessionsForHost } from "./sessions";


// ─────────────────────────────────────────────────────────────────
// User provisioning (called by the auth layer on sign-in)
// ─────────────────────────────────────────────────────────────────

export async function upsertUser(input: {
  email: string;
  neonAuthId: string | null;
  displayName: string | null;
}): Promise<{
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
}> {
  return dbCall(async () => {
    const [row] = await db
      .insert(users)
      .values({
        email: input.email,
        neonAuthId: input.neonAuthId,
        displayName: input.displayName,
      })
      // Note: is_admin is intentionally not in `set` — sign-in must never
      // change a user's admin status.
      .onConflictDoUpdate({
        target: users.email,
        set: {
          neonAuthId: input.neonAuthId,
          displayName: input.displayName,
          updatedAt: new Date(),
        },
      })
      .returning();
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      isAdmin: row.isAdmin,
    };
  });
}


// ─────────────────────────────────────────────────────────────────
// Per-host ElevenLabs API key (encrypted at rest; see src/lib/crypto.ts)
// ─────────────────────────────────────────────────────────────────

export type ElevenLabsKeyStatus = {
  hasKey: boolean;
  hint: string | null;
  addedAt: string | null;
};


/** Store the host's encrypted key + masked hint. Caller validates + encrypts. */
export async function setElevenLabsKey(
  userId: string,
  ciphertext: string,
  hint: string
): Promise<void> {
  await dbCall(async () => {
    await db
      .update(users)
      .set({
        elevenlabsKeyCiphertext: ciphertext,
        elevenlabsKeyHint: hint,
        elevenlabsKeyAddedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  });
}


/** Remove the host's stored key. */
export async function clearElevenLabsKey(userId: string): Promise<void> {
  await dbCall(async () => {
    await db
      .update(users)
      .set({
        elevenlabsKeyCiphertext: null,
        elevenlabsKeyHint: null,
        elevenlabsKeyAddedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  });
}


/** Console-facing status — never returns the ciphertext. */
export async function getElevenLabsKeyStatus(
  userId: string
): Promise<ElevenLabsKeyStatus> {
  return dbCall(async () => {
    const [row] = await db
      .select({
        hint: users.elevenlabsKeyHint,
        addedAt: users.elevenlabsKeyAddedAt,
        ciphertext: users.elevenlabsKeyCiphertext,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return {
      hasKey: Boolean(row?.ciphertext),
      hint: row?.hint ?? null,
      addedAt: toIso(row?.addedAt ?? null),
    };
  });
}


/**
 * True when a host must connect their own key before generating: a non-admin
 * with no stored key. Used to fail request creation fast with a clear message.
 */
export async function hostNeedsApiKey(hostId: string): Promise<boolean> {
  return dbCall(async () => {
    const [row] = await db
      .select({
        isAdmin: users.isAdmin,
        ciphertext: users.elevenlabsKeyCiphertext,
      })
      .from(users)
      .where(eq(users.id, hostId))
      .limit(1);
    if (!row) return false; // unknown user — let downstream auth handle it
    return !row.isAdmin && !row.ciphertext;
  });
}


/**
 * Resolve a session's host key material for the generation pipeline: the host's
 * encrypted key (to decrypt) plus their admin flag (to decide shared-key
 * fallback). Joined from a session_id since generation only carries the request.
 */
export async function getSessionHostKey(sessionId: string): Promise<{
  hostId: string;
  isAdmin: boolean;
  keyCiphertext: string | null;
} | null> {
  return dbCall(async () => {
    const [row] = await db
      .select({
        hostId: users.id,
        isAdmin: users.isAdmin,
        keyCiphertext: users.elevenlabsKeyCiphertext,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.hostId, users.id))
      .where(eq(sessions.id, sessionId))
      .limit(1);
    return row ?? null;
  });
}


// ─────────────────────────────────────────────────────────────────
// Admin (cross-tenant) — callers MUST be requireAdmin()-gated. These are
// the only queries that read/write across host boundaries.
// ─────────────────────────────────────────────────────────────────

/** A user as seen in the admin console, with rollup counts. */
export type AdminUser = {
  id: string;
  email: string;
  displayName: string | null;
  isAdmin: boolean;
  createdAt: string;
  sessionCount: number;
  trackCount: number;
  // The user's currently-live session, so an admin can jump straight to its
  // stage to listen along. Null when the user has no active session.
  liveSessionCode: string | null;
  liveSessionName: string | null;
};


type UserRollups = {
  sessionCount: number;
  trackCount: number;
  liveSessionCode: string | null;
  liveSessionName: string | null;
};


/** Session + file rollups for a single user (used to shape an AdminUser). */
async function userRollups(userId: string): Promise<UserRollups> {
  const [{ value: sessionCount }] = await db
    .select({ value: count() })
    .from(sessions)
    .where(eq(sessions.hostId, userId));
  const [{ value: trackCount }] = await db
    .select({ value: count() })
    .from(songRequests)
    .where(
      and(
        inArray(songRequests.sessionId, ownedSessionIds(userId)),
        isNotNull(songRequests.audioUrl)
      )
    );
  const [live] = await db
    .select({ code: sessions.publicCode, name: sessions.name })
    .from(sessions)
    .where(
      and(
        eq(sessions.hostId, userId),
        eq(sessions.isActive, true),
        eq(sessions.source, "local")
      )
    )
    .orderBy(desc(sessions.createdAt))
    .limit(1);
  return {
    sessionCount: sessionCount ?? 0,
    trackCount: trackCount ?? 0,
    liveSessionCode: live?.code ?? null,
    liveSessionName: live?.name ?? null,
  };
}


function mapAdminUser(row: UserRow, rollups: UserRollups): AdminUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    isAdmin: row.isAdmin,
    createdAt: toIso(row.createdAt) as string,
    sessionCount: rollups.sessionCount,
    trackCount: rollups.trackCount,
    liveSessionCode: rollups.liveSessionCode,
    liveSessionName: rollups.liveSessionName,
  };
}


/** Every user with session/track rollups, newest first. Admin-only. */
export async function listAllUsers(): Promise<AdminUser[]> {
  return dbCall(async () => {
    const rows = await db.select().from(users).orderBy(desc(users.createdAt));
    return Promise.all(
      rows.map(async (row) => mapAdminUser(row, await userRollups(row.id)))
    );
  });
}


/** Whether a user id exists, without loading the whole table. */
export async function userExists(userId: string): Promise<boolean> {
  return dbCall(async () => {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return Boolean(row);
  });
}


/** A specific user's sessions (with track counts). Admin-only. */
export async function adminListSessionsForUser(
  userId: string
): Promise<HostSession[]> {
  // listSessionsForHost is already generic over a host id; an admin simply
  // passes a target user's id. Cross-tenant access is gated by requireAdmin().
  return listSessionsForHost(userId);
}


/** Grant or revoke a user's admin flag. Admin-only; can't demote yourself. */
export async function setUserAdmin(
  actingUserId: string,
  targetUserId: string,
  isAdmin: boolean
): Promise<AdminUser> {
  return dbCall(async () => {
    if (actingUserId === targetUserId && !isAdmin) {
      throw new AppError(
        400,
        "cannot_demote_self",
        "You can’t remove your own admin access."
      );
    }
    const [updated] = await db
      .update(users)
      .set({ isAdmin, updatedAt: new Date() })
      .where(eq(users.id, targetUserId))
      .returning();
    if (!updated) {
      throw new AppError(404, "user_not_found", "User not found.");
    }
    return mapAdminUser(updated, await userRollups(updated.id));
  });
}
