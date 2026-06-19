import "server-only";

import { randomUUID } from "node:crypto";

import { del } from "@vercel/blob";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  ne,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  requestEvents,
  sessions,
  songRequests,
  users,
  type SessionRow,
  type SongRequestRow,
  type UserRow,
} from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import {
  generateClientToken,
  hashValue,
  normalizePrompt,
  type RequestInput,
} from "@/lib/security";
import { STATION_ID_BRAND, STATION_ID_DURATION_MS } from "@/lib/station-id";
import {
  REALTIME_TOPIC,
  REQUEST_STATUSES,
  type Lyrics,
  type NowPlaying,
  type QueueItem,
  type QueueSnapshot,
  type RequestStatus,
  type Session,
} from "@/lib/status";

/**
 * Snake_case request record. The generation pipeline (lib/generation.ts) and
 * other internals read these field names, so we keep the legacy shape stable
 * across the Supabase→Neon move and map the Drizzle row into it.
 */
export type SongRequestRecord = {
  id: string;
  session_id: string;
  client_token_hash: string;
  requester_name: string | null;
  kind: string;
  prompt: string;
  normalized_prompt: string;
  status: RequestStatus;
  position: number | null;
  duration_ms: number;
  audio_url: string | null;
  blob_path: string | null;
  song_id: string | null;
  prompt_suggestion: string | null;
  error_code: string | null;
  error_message: string | null;
  ip_hash: string | null;
  idempotency_key: string;
  generation_attempts: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  force_instrumental: boolean;
  lyrics: Lyrics | null;
  title: string | null;
  is_explicit: boolean;
};

/** A session enriched with its public link slug, for the host console. */
export type HostSession = Session & {
  publicCode: string;
  requestsOpen: boolean;
  autoDj: boolean;
  defaultDurationMs: number;
  forceInstrumental: boolean;
  // Station ID settings — host-only (the public queue snapshot exposes just the
  // enabled flag; the personalization name never leaves the host console).
  stationIdEnabled: boolean;
  stationIdPersonalize: boolean;
  stationIdHostName: string | null;
};

const activeStatuses: RequestStatus[] = [
  "pending",
  "queued",
  "generating",
  "ready",
];

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** Postgres unique_violation — surfaced by the neon driver as code 23505. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/** Wrap a DB operation so unexpected driver errors become a friendly 503. */
async function dbCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    console.error("Neon DB operation failed", error);
    throw new AppError(
      503,
      "database_unavailable",
      "The request line is unavailable. Try again shortly."
    );
  }
}

function toRecord(row: SongRequestRow): SongRequestRecord {
  return {
    id: row.id,
    session_id: row.sessionId,
    client_token_hash: row.clientTokenHash,
    requester_name: row.requesterName,
    kind: row.kind,
    prompt: row.prompt,
    normalized_prompt: row.normalizedPrompt,
    status: row.status as RequestStatus,
    position: row.position,
    duration_ms: row.durationMs,
    audio_url: row.audioUrl,
    blob_path: row.blobPath,
    song_id: row.songId,
    prompt_suggestion: row.promptSuggestion,
    error_code: row.errorCode,
    error_message: row.errorMessage,
    ip_hash: row.ipHash,
    idempotency_key: row.idempotencyKey,
    generation_attempts: row.generationAttempts,
    started_at: toIso(row.startedAt),
    completed_at: toIso(row.completedAt),
    created_at: toIso(row.createdAt) as string,
    updated_at: toIso(row.updatedAt) as string,
    metadata: row.metadata ?? {},
    force_instrumental: row.forceInstrumental,
    lyrics: row.lyrics ?? null,
    title: row.title,
    is_explicit: row.isExplicit,
  };
}

function mapQueueItem(row: SongRequestRow): QueueItem {
  return {
    id: row.id,
    requesterName: row.requesterName,
    prompt: row.prompt,
    status: row.status as RequestStatus,
    position: row.position,
    durationMs: row.durationMs,
    audioUrl: row.audioUrl,
    title: row.title ?? null,
    isExplicit: row.isExplicit ?? false,
    promptSuggestion: row.promptSuggestion,
    errorMessage: row.errorMessage,
    lyrics: row.lyrics ?? null,
    createdAt: toIso(row.createdAt) as string,
    updatedAt: toIso(row.updatedAt) as string,
    completedAt: toIso(row.completedAt),
  };
}

function mapSession(row: SessionRow, trackCount?: number): HostSession {
  return {
    id: row.id,
    name: row.name,
    createdAt: toIso(row.createdAt) as string,
    isActive: row.isActive,
    publicCode: row.publicCode,
    requestsOpen: row.requestsOpen,
    autoDj: row.autoDj,
    defaultDurationMs: row.defaultDurationMs,
    forceInstrumental: row.forceInstrumental,
    stationIdEnabled: row.stationIdEnabled,
    stationIdPersonalize: row.stationIdPersonalize,
    stationIdHostName: row.stationIdHostName,
    ...(trackCount === undefined ? {} : { trackCount }),
  };
}

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

/** Resolve a public_code to its session id, or throw a 404. */
async function requireSessionByCode(code: string): Promise<SessionRow> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.publicCode, code))
    .limit(1);
  if (!row) {
    throw new AppError(404, "session_not_found", "That request link is invalid or expired.");
  }
  return row;
}

/** The newest active session for a host, or null if none exists. */
async function selectActiveSession(hostId: string): Promise<SessionRow | null> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.hostId, hostId), eq(sessions.isActive, true)))
    .orderBy(desc(sessions.createdAt))
    .limit(1);
  return row ?? null;
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

export async function setAutoDj(hostId: string, autoDj: boolean): Promise<void> {
  await dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    await db
      .update(sessions)
      .set({ autoDj })
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

/** Personalization config read by the generation pipeline when building IDs. */
export async function getStationIdConfig(
  sessionId: string
): Promise<{ personalize: boolean; hostName: string | null } | null> {
  return dbCall(async () => {
    const [row] = await db
      .select({
        personalize: sessions.stationIdPersonalize,
        hostName: sessions.stationIdHostName,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    return row ?? null;
  });
}

/**
 * Create a station-ID request row (kind="station_id") in `queued` status, ready
 * for the generation pipeline. Not part of the public queue (position is null,
 * kind excludes it from `items` and request-scoped limits). The caller enqueues
 * generation for the returned id. Returns null if the session is gone.
 */
export async function createStationIdRequest(
  sessionId: string
): Promise<string | null> {
  return dbCall(async () => {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!session) {
      return null;
    }
    // Unique per call so the idempotency key never collides when the pool
    // top-up inserts several IDs in the same millisecond.
    const stamp = randomUUID();
    const [created] = await db
      .insert(songRequests)
      .values({
        sessionId: session.id,
        clientTokenHash: hashValue(`station-id:${sessionId}`, "client-token"),
        requesterName: "ElevenDJ Radio",
        kind: "station_id",
        prompt: STATION_ID_BRAND,
        normalizedPrompt: `station-id:${stamp}`,
        status: "queued",
        position: null,
        durationMs: STATION_ID_DURATION_MS,
        forceInstrumental: false,
        title: "Station ID",
        idempotencyKey: hashValue(
          `station-id:${sessionId}:${stamp}`,
          "idempotency"
        ),
      })
      .returning({ id: songRequests.id });
    await recordEvent(created.id, "station_id_created", {});
    return created.id;
  });
}

/** Ready station IDs (warm pool) for a session, oldest first. */
export async function listReadyStationIds(
  sessionId: string
): Promise<QueueItem[]> {
  return dbCall(async () => {
    const rows = await db
      .select()
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, sessionId),
          eq(songRequests.kind, "station_id"),
          eq(songRequests.status, "ready"),
          isNotNull(songRequests.audioUrl)
        )
      )
      .orderBy(asc(songRequests.createdAt));
    return rows.map(mapQueueItem);
  });
}

/**
 * Count station IDs that are already "warm or warming" (queued/generating/ready)
 * so the pool top-up only generates the shortfall.
 */
export async function countWarmStationIds(sessionId: string): Promise<number> {
  return dbCall(async () => {
    const [{ value }] = await db
      .select({ value: count() })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, sessionId),
          eq(songRequests.kind, "station_id"),
          inArray(songRequests.status, ["queued", "generating", "ready"])
        )
      );
    return value ?? 0;
  });
}

/** Mark a played station ID as archived so the pool top-up regenerates a fresh one. */
export async function consumeStationId(
  hostId: string,
  id: string
): Promise<void> {
  await dbCall(async () => {
    await db
      .update(songRequests)
      .set({ status: "archived" })
      .where(
        and(
          eq(songRequests.id, id),
          eq(songRequests.kind, "station_id"),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      );
    await recordEvent(id, "station_id_played", {});
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
// Playback (host-scoped) + now-playing (public, by session)
// ─────────────────────────────────────────────────────────────────

export async function setPlaybackState(
  hostId: string,
  requestId: string | null,
  isPlaying: boolean
): Promise<void> {
  await dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    await db
      .update(sessions)
      .set({
        currentRequestId: requestId,
        isPlaying,
        ...(isPlaying ? { playbackStartedAt: new Date() } : {}),
      })
      .where(and(eq(sessions.id, active.id), eq(sessions.hostId, hostId)));
  });
}

export async function getNowPlaying(sessionId: string): Promise<NowPlaying> {
  return dbCall(async () => {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }

    const requestsOpen = session.requestsOpen;
    const autoDj = session.autoDj;

    if (!session.currentRequestId) {
      return { isPlaying: false, requestsOpen, autoDj, track: null };
    }

    const [requestRow] = await db
      .select()
      .from(songRequests)
      .where(eq(songRequests.id, session.currentRequestId))
      .limit(1);

    if (!requestRow) {
      return { isPlaying: session.isPlaying, requestsOpen, autoDj, track: null };
    }

    return {
      isPlaying: session.isPlaying,
      requestsOpen,
      autoDj,
      track: {
        id: requestRow.id,
        prompt: requestRow.prompt,
        requesterName: requestRow.requesterName,
        status: requestRow.status as RequestStatus,
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────────
// Queue snapshots
// ─────────────────────────────────────────────────────────────────

async function buildQueueSnapshot(session: SessionRow): Promise<QueueSnapshot> {
  // The public queue is audience requests only. Station IDs share the table
  // but are surfaced separately (below) so they never appear in the queue or
  // count toward limits.
  const [rows, stationIdRows] = await Promise.all([
    db
      .select()
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, session.id),
          eq(songRequests.kind, "request"),
          inArray(songRequests.status, activeStatuses)
        )
      )
      .orderBy(
        sql`${songRequests.position} asc nulls last`,
        asc(songRequests.createdAt)
      ),
    db
      .select()
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, session.id),
          eq(songRequests.kind, "station_id"),
          eq(songRequests.status, "ready"),
          isNotNull(songRequests.audioUrl)
        )
      )
      .orderBy(asc(songRequests.createdAt)),
  ]);

  const counts = Object.fromEntries(
    REQUEST_STATUSES.map((status) => [status, 0])
  ) as Record<RequestStatus, number>;

  const items = rows.map((row) => {
    counts[row.status as RequestStatus] += 1;
    return mapQueueItem(row);
  });

  return {
    topic: `${REALTIME_TOPIC}:${session.publicCode}`,
    requestsOpen: session.requestsOpen,
    autoDj: session.autoDj,
    defaultDurationMs: session.defaultDurationMs,
    forceInstrumental: session.forceInstrumental,
    orbColorway: session.orbColorway,
    masterVolume: session.masterVolume,
    stationIdEnabled: session.stationIdEnabled,
    stationIds: stationIdRows.map(mapQueueItem),
    items,
    counts,
  };
}

/** Public queue snapshot for a session id (request line / stage). */
export async function getQueueSnapshot(sessionId: string): Promise<QueueSnapshot> {
  return dbCall(async () => {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!session) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }
    return buildQueueSnapshot(session);
  });
}

export async function getAdminOverview(hostId: string) {
  return dbCall(async () => {
    const active = await getActiveSessionForHost(hostId);
    const [sessionRow] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, active.id))
      .limit(1);

    const [queue, recent, files, sessionList, apiKey] = await Promise.all([
      buildQueueSnapshot(sessionRow),
      db
        .select()
        .from(songRequests)
        .where(
          and(
            eq(songRequests.sessionId, active.id),
            eq(songRequests.kind, "request")
          )
        )
        .orderBy(desc(songRequests.createdAt))
        .limit(75),
      listFiles(hostId),
      listSessionsForHost(hostId),
      getElevenLabsKeyStatus(hostId),
    ]);

    return {
      activeSession: mapSession(sessionRow),
      queue,
      recent: recent.map(mapQueueItem),
      files,
      sessions: sessionList,
      apiKey,
    };
  });
}

// ─────────────────────────────────────────────────────────────────
// Request creation (public by code / host-authored)
// ─────────────────────────────────────────────────────────────────

export async function createSongRequest(
  sessionId: string,
  input: RequestInput,
  ipHash: string,
  options: { asHost?: boolean } = {}
) {
  return dbCall(async () => {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!session) {
      throw new AppError(404, "session_not_found", "Session not found.");
    }

    // The host can spin a track even while the public line is paused.
    if (!options.asHost && !session.requestsOpen) {
      throw new AppError(403, "requests_closed", "The request line is closed.");
    }

    // Per-connection rate limit guards the public form (per session); the
    // authenticated host is trusted and exempt.
    if (!options.asHost) {
      const since = new Date(Date.now() - 10 * 60 * 1000);
      const [{ value: recentCount }] = await db
        .select({ value: count() })
        .from(songRequests)
        .where(
          and(
            eq(songRequests.sessionId, session.id),
            eq(songRequests.ipHash, ipHash),
            gte(songRequests.createdAt, since)
          )
        );
      if ((recentCount ?? 0) >= 3) {
        throw new AppError(
          429,
          "rate_limited",
          "Too many requests from this connection. Wait a few minutes before sending another."
        );
      }
    }

    const [{ value: activeCount }] = await db
      .select({ value: count() })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, session.id),
          eq(songRequests.kind, "request"),
          inArray(songRequests.status, activeStatuses)
        )
      );

    if ((activeCount ?? 0) >= session.maxPendingRequests) {
      throw new AppError(
        409,
        "queue_full",
        "The queue is full right now. Try again after the next track starts."
      );
    }

    const normalizedPrompt = normalizePrompt(input.prompt);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [duplicate] = await db
      .select({ id: songRequests.id })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, session.id),
          eq(songRequests.kind, "request"),
          eq(songRequests.normalizedPrompt, normalizedPrompt),
          inArray(songRequests.status, activeStatuses),
          gte(songRequests.createdAt, dayAgo)
        )
      )
      .limit(1);

    if (duplicate) {
      throw new AppError(
        409,
        "duplicate_prompt",
        "That request is already in the queue."
      );
    }

    const [lastPosition] = await db
      .select({ position: songRequests.position })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, session.id),
          isNotNull(songRequests.position)
        )
      )
      .orderBy(desc(songRequests.position))
      .limit(1);

    const clientToken = generateClientToken();
    const tokenHash = hashValue(clientToken, "client-token");
    const nextPosition = Number(lastPosition?.position ?? 0) + 1;

    // AutoDJ generates immediately (`queued`); approval mode holds the request
    // in `pending`. A host-authored track is implicitly approved.
    const initialStatus: RequestStatus =
      options.asHost || session.autoDj ? "queued" : "pending";

    const [created] = await db
      .insert(songRequests)
      .values({
        sessionId: session.id,
        clientTokenHash: tokenHash,
        requesterName: input.requesterName ?? null,
        prompt: input.prompt,
        normalizedPrompt,
        status: initialStatus,
        position: nextPosition,
        durationMs: session.defaultDurationMs,
        forceInstrumental: input.instrumental ?? false,
        ipHash,
        idempotencyKey: hashValue(
          `${ipHash}:${normalizedPrompt}:${Date.now()}`,
          "idempotency"
        ),
      })
      .returning();

    await recordEvent(created.id, "request_created", { position: nextPosition });

    return { request: toRecord(created), clientToken };
  });
}

export async function getRequestByClientToken(id: string, clientToken: string) {
  return dbCall(async () => {
    const tokenHash = hashValue(clientToken, "client-token");
    const [row] = await db
      .select()
      .from(songRequests)
      .where(
        and(
          eq(songRequests.id, id),
          eq(songRequests.clientTokenHash, tokenHash)
        )
      )
      .limit(1);

    if (!row) {
      throw new AppError(404, "request_not_found", "No request matched that token.");
    }
    return mapQueueItem(row);
  });
}

// ─────────────────────────────────────────────────────────────────
// Host approval / lifecycle (host-scoped, IDOR-guarded)
// ─────────────────────────────────────────────────────────────────

/** Subquery: session ids owned by this host (IDOR guard for request mutations). */
function ownedSessionIds(hostId: string) {
  return db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.hostId, hostId));
}

export async function approveRequest(
  hostId: string,
  id: string
): Promise<SongRequestRecord | null> {
  return dbCall(async () => {
    const [row] = await db
      .update(songRequests)
      .set({
        status: "queued",
        errorCode: null,
        errorMessage: null,
        promptSuggestion: null,
      })
      .where(
        and(
          eq(songRequests.id, id),
          eq(songRequests.status, "pending"),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      )
      .returning();

    if (!row) {
      return null;
    }
    await recordEvent(id, "request_approved", {});
    return toRecord(row);
  });
}

export async function rejectRequest(
  hostId: string,
  id: string,
  reason = "Rejected by DJ."
) {
  await dbCall(async () => {
    await db
      .update(songRequests)
      .set({
        status: "rejected",
        errorCode: "admin_rejected",
        errorMessage: reason,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      );
    await recordEvent(id, "request_rejected", { reason });
  });
}

export async function requeueRequest(hostId: string, id: string) {
  await dbCall(async () => {
    // Grab the current audio first (host-scoped) so we can drop the stale blob
    // after clearing the row.
    const [existing] = await db
      .select({ audioUrl: songRequests.audioUrl })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      )
      .limit(1);

    await db
      .update(songRequests)
      .set({
        status: "queued",
        audioUrl: null,
        blobPath: null,
        songId: null,
        title: null,
        isExplicit: false,
        errorCode: null,
        errorMessage: null,
        promptSuggestion: null,
        completedAt: null,
        startedAt: null,
      })
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      );

    // Delete the now-unreferenced blob so a requeued-but-not-yet-regenerated
    // track doesn't leave an orphan behind. Best-effort — a missing blob must
    // not block the requeue. Regeneration writes the same deterministic path.
    if (existing?.audioUrl) {
      try {
        await del(existing.audioUrl);
      } catch (error) {
        console.error("Failed to delete stale blob on requeue", error);
      }
    }

    await recordEvent(id, "request_requeued", {});
  });
}

export async function markRequestPlayed(hostId: string, id: string) {
  await dbCall(async () => {
    await db
      .update(songRequests)
      .set({ status: "played" })
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      );
    await recordEvent(id, "request_played", {});
  });
}

export async function removeFromQueue(
  hostId: string,
  id: string
): Promise<QueueItem> {
  return dbCall(async () => {
    const [row] = await db
      .update(songRequests)
      .set({ status: "archived", position: null })
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      )
      .returning();
    if (!row) {
      throw new AppError(404, "request_not_found", "Request not found.");
    }
    await recordEvent(id, "request_archived", {});
    return mapQueueItem(row);
  });
}

export async function addToQueue(hostId: string, id: string): Promise<QueueItem> {
  return dbCall(async () => {
    // Locate the request (host-scoped) so we can compute its session's next slot.
    const [target] = await db
      .select()
      .from(songRequests)
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      )
      .limit(1);
    if (!target) {
      throw new AppError(404, "request_not_found", "Request not found.");
    }

    const [maxPosition] = await db
      .select({ position: songRequests.position })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.sessionId, target.sessionId),
          eq(songRequests.status, "ready"),
          isNotNull(songRequests.position)
        )
      )
      .orderBy(desc(songRequests.position))
      .limit(1);

    const nextPosition = Number(maxPosition?.position ?? 0) + 1;

    const [row] = await db
      .update(songRequests)
      .set({ status: "ready", position: nextPosition })
      .where(eq(songRequests.id, id))
      .returning();

    await recordEvent(id, "request_queued", { position: nextPosition });
    return mapQueueItem(row);
  });
}

export async function deleteRequest(
  hostId: string,
  id: string
): Promise<{ ok: true }> {
  return dbCall(async () => {
    const [row] = await db
      .select({ audioUrl: songRequests.audioUrl })
      .from(songRequests)
      .where(
        and(
          eq(songRequests.id, id),
          inArray(songRequests.sessionId, ownedSessionIds(hostId))
        )
      )
      .limit(1);
    if (!row) {
      throw new AppError(404, "request_not_found", "Request not found.");
    }

    if (row.audioUrl) {
      await del(row.audioUrl);
    }

    await db.delete(songRequests).where(eq(songRequests.id, id));
    return { ok: true };
  });
}

export async function reorderQueue(
  hostId: string,
  orderedIds: string[]
): Promise<void> {
  await dbCall(async () => {
    for (let i = 0; i < orderedIds.length; i += 1) {
      await db
        .update(songRequests)
        .set({ position: i + 1 })
        .where(
          and(
            eq(songRequests.id, orderedIds[i]),
            inArray(songRequests.sessionId, ownedSessionIds(hostId))
          )
        );
    }
  });
}

export async function listFiles(
  hostId: string,
  sessionId?: string
): Promise<QueueItem[]> {
  return dbCall(async () => {
    const ownedFilter = inArray(songRequests.sessionId, ownedSessionIds(hostId));

    let whereClause = and(ownedFilter, isNotNull(songRequests.audioUrl));
    if (sessionId && sessionId !== "all") {
      whereClause = and(whereClause, eq(songRequests.sessionId, sessionId));
    } else if (!sessionId) {
      const active = await getActiveSessionForHost(hostId);
      whereClause = and(whereClause, eq(songRequests.sessionId, active.id));
    }

    const rows = await db
      .select()
      .from(songRequests)
      .where(whereClause)
      .orderBy(desc(songRequests.createdAt));

    return rows.map(mapQueueItem);
  });
}

export async function bulkAction(
  hostId: string,
  action: "delete" | "remove_from_queue" | "add_to_queue",
  ids: string[]
): Promise<number> {
  let processed = 0;
  for (const id of ids) {
    if (action === "delete") {
      await deleteRequest(hostId, id);
    } else if (action === "remove_from_queue") {
      await removeFromQueue(hostId, id);
    } else {
      await addToQueue(hostId, id);
    }
    processed += 1;
  }
  return processed;
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
    .where(and(eq(sessions.hostId, userId), eq(sessions.isActive, true)))
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

// ─────────────────────────────────────────────────────────────────
// Generation worker (operates by request id; no host scoping)
// ─────────────────────────────────────────────────────────────────

export async function claimRequestForGeneration(id: string) {
  return dbCall(async () => {
    const [existing] = await db
      .select()
      .from(songRequests)
      .where(eq(songRequests.id, id))
      .limit(1);

    if (!existing) {
      return null;
    }
    if (existing.status !== "queued") {
      return null;
    }

    const [row] = await db
      .update(songRequests)
      .set({
        status: "generating",
        generationAttempts: existing.generationAttempts + 1,
        startedAt: new Date(),
        errorCode: null,
        errorMessage: null,
        promptSuggestion: null,
      })
      .where(and(eq(songRequests.id, id), eq(songRequests.status, "queued")))
      .returning();

    if (!row) {
      return null;
    }
    await recordEvent(id, "generation_started", {
      attempt: existing.generationAttempts + 1,
    });
    return toRecord(row);
  });
}

export async function markRequestReady(
  id: string,
  audioUrl: string,
  blobPath: string,
  songId: string | null,
  lyrics: Lyrics | null = null,
  meta: {
    title?: string | null;
    isExplicit?: boolean;
    songMetadata?: Record<string, unknown>;
  } = {}
) {
  await dbCall(async () => {
    await db
      .update(songRequests)
      .set({
        status: "ready",
        audioUrl,
        blobPath,
        songId,
        lyrics,
        title: meta.title ?? null,
        isExplicit: meta.isExplicit ?? false,
        ...(meta.songMetadata ? { metadata: meta.songMetadata } : {}),
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      })
      .where(eq(songRequests.id, id));

    await recordEvent(id, "generation_completed", {
      audioUrl,
      songId,
      title: meta.title ?? null,
    });
  });
}

export async function markRequestFailed(
  id: string,
  code: string,
  message: string,
  suggestion?: string
) {
  await dbCall(async () => {
    const status: RequestStatus = code === "bad_prompt" ? "rejected" : "failed";
    await db
      .update(songRequests)
      .set({
        status,
        errorCode: code,
        errorMessage: message,
        promptSuggestion: suggestion ?? null,
        completedAt: new Date(),
      })
      .where(eq(songRequests.id, id));

    await recordEvent(
      id,
      status === "rejected" ? "request_rejected" : "generation_failed",
      { code, message, suggestion }
    );
  });
}

async function recordEvent(
  requestId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  try {
    await db.insert(requestEvents).values({ requestId, eventType, payload });
  } catch (error) {
    console.error("Failed to record request event", error);
  }
}

export { requireSessionByCode };
