import "server-only";

import { del } from "@vercel/blob";
import { and, count, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessions, songRequests } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import { dbCall, isUniqueViolation, mapSession, selectActiveSession } from "./internal";
import type { HostSession } from "./internal";


// ─────────────────────────────────────────────────────────────────
// Session resolution
// ─────────────────────────────────────────────────────────────────

export async function getSessionByCode(
  code: string
): Promise<HostSession | null> {
  return dbCall(async () => {
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.publicCode, code))
      .limit(1);
    return row ? mapSession(row) : null;
  });
}


/** The active session for a host, creating one on first use. */
export async function getActiveSessionForHost(
  hostId: string
): Promise<HostSession> {
  return dbCall(async () => {
    const existing = await selectActiveSession(hostId);
    if (existing) {
      return mapSession(existing);
    }
    // No active session yet — try to seed one. Concurrent first-load requests
    // can reach here together; the `sessions_one_active_per_host` index lets
    // only one INSERT win, and the loser re-selects the winner's row instead
    // of spawning a duplicate active session.
    try {
      const [created] = await db
        .insert(sessions)
        .values({ name: "Session 1", hostId, isActive: true })
        .returning();
      return mapSession(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const winner = await selectActiveSession(hostId);
        if (winner) {
          return mapSession(winner);
        }
      }
      throw error;
    }
  });
}


export async function listSessionsForHost(hostId: string): Promise<HostSession[]> {
  return dbCall(async () => {
    const rows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.hostId, hostId))
      .orderBy(desc(sessions.createdAt));

    return Promise.all(
      rows.map(async (row) => {
        const [{ value }] = await db
          .select({ value: count() })
          .from(songRequests)
          .where(
            and(
              eq(songRequests.sessionId, row.id),
              isNotNull(songRequests.audioUrl)
            )
          );
        return mapSession(row, value ?? 0);
      })
    );
  });
}


export async function createSessionForHost(
  hostId: string,
  name?: string
): Promise<HostSession> {
  return dbCall(async () => {
    await db
      .update(sessions)
      .set({ isActive: false, endedAt: new Date() })
      .where(and(eq(sessions.hostId, hostId), eq(sessions.isActive, true)));

    let sessionName = name?.trim();
    if (!sessionName) {
      const [{ value }] = await db
        .select({ value: count() })
        .from(sessions)
        .where(eq(sessions.hostId, hostId));
      sessionName = `Session ${(value ?? 0) + 1}`;
    }

    const [created] = await db
      .insert(sessions)
      .values({ name: sessionName, hostId, isActive: true })
      .returning();
    return mapSession(created);
  });
}


/** Issue a fresh public_code for a host's session (invalidates the old link). */
export async function regeneratePublicCode(
  hostId: string,
  sessionId: string
): Promise<HostSession> {
  return dbCall(async () => {
    const [updated] = await db
      .update(sessions)
      .set({ publicCode: sql`encode(gen_random_bytes(6), 'hex')` })
      .where(and(eq(sessions.id, sessionId), eq(sessions.hostId, hostId)))
      .returning();
    if (!updated) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }
    return mapSession(updated);
  });
}


/** Rename a host's session (host-scoped; IDOR-guarded). */
export async function renameSession(
  hostId: string,
  sessionId: string,
  name: string
): Promise<HostSession> {
  return dbCall(async () => {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) {
      throw new AppError(400, "invalid_request", "Session name is required.");
    }
    const [updated] = await db
      .update(sessions)
      .set({ name: trimmed })
      .where(and(eq(sessions.id, sessionId), eq(sessions.hostId, hostId)))
      .returning();
    if (!updated) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }
    return mapSession(updated);
  });
}


/**
 * Make `sessionId` the host's live session. Deactivates any other active
 * session first so the one-active-per-host index is never momentarily
 * violated, then promotes the target. Host-scoped (IDOR-guarded).
 */
export async function activateSession(
  hostId: string,
  sessionId: string
): Promise<HostSession> {
  return dbCall(async () => {
    const [target] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.hostId, hostId)))
      .limit(1);
    if (!target) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }

    await db
      .update(sessions)
      .set({ isActive: false, endedAt: new Date() })
      .where(
        and(
          eq(sessions.hostId, hostId),
          eq(sessions.isActive, true),
          ne(sessions.id, sessionId)
        )
      );

    const [updated] = await db
      .update(sessions)
      .set({ isActive: true, endedAt: null })
      .where(and(eq(sessions.id, sessionId), eq(sessions.hostId, hostId)))
      .returning();
    if (!updated) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }
    return mapSession(updated);
  });
}


/**
 * Delete a host's session and its tracks. Refuses the active session (switch
 * away first) so a host can't accidentally nuke the live room. Vercel Blob
 * audio is removed explicitly; the song_requests rows go via FK cascade.
 * Host-scoped (IDOR-guarded).
 */
export async function deleteSession(
  hostId: string,
  sessionId: string
): Promise<{ ok: true }> {
  return dbCall(async () => {
    const [target] = await db
      .select({ id: sessions.id, isActive: sessions.isActive })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.hostId, hostId)))
      .limit(1);
    if (!target) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }
    if (target.isActive) {
      throw new AppError(
        400,
        "session_active",
        "Switch to another session before deleting this one."
      );
    }

    const audioRows = await db
      .select({ audioUrl: songRequests.audioUrl })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, sessionId),
          isNotNull(songRequests.audioUrl)
        )
      );
    const urls = audioRows
      .map((row) => row.audioUrl)
      .filter((url): url is string => Boolean(url));
    if (urls.length > 0) {
      try {
        await del(urls);
      } catch (error) {
        // A blob that's already gone shouldn't block deleting the record.
        console.error("Failed to delete session blobs", error);
      }
    }

    await db
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.hostId, hostId)));
    return { ok: true };
  });
}
