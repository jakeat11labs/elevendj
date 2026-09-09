import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { requestEvents, sessions } from "@/lib/db/schema";
import type { SessionRow, SongRequestRow } from "@/lib/db/schema";
import { AppError } from "@/lib/errors";
import type { Lyrics, QueueItem, RequestStatus, Session } from "@/lib/status";


/**
 * Snake_case request record. The generation pipeline (lib/generation) and
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
  source?: "local" | "integration";
  roomName?: string | null;
  externalSessionId?: string | null;
};


export const activeStatuses: RequestStatus[] = [
  "pending",
  "queued",
  "generating",
  "ready",
];


export function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}


/** Postgres unique_violation — surfaced by the neon driver as code 23505. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}


/** Wrap a DB operation so unexpected driver errors become a friendly 503. */
export async function dbCall<T>(run: () => Promise<T>): Promise<T> {
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


export function toRecord(row: SongRequestRow): SongRequestRecord {
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


export function mapQueueItem(row: SongRequestRow): QueueItem {
  return {
    id: row.id,
    kind: row.kind === "station_id" ? "station_id" : "song",
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


export function mapSession(row: SessionRow, trackCount?: number): HostSession {
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
    source: row.source === "integration" ? "integration" : "local",
    roomName: row.roomName ?? null,
    externalSessionId: row.externalSessionId ?? null,
    ...(trackCount === undefined ? {} : { trackCount }),
  };
}


/** Resolve a public_code to its session id, or throw a 404. */
export async function requireSessionByCode(code: string): Promise<SessionRow> {
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

/**
 * Resolve a public_code that is still accepting requests. Ended sessions keep
 * their generated files but reject new guest submissions.
 */
export async function requireActiveSessionByCode(
  code: string
): Promise<SessionRow> {
  const row = await requireSessionByCode(code);
  if (!row.isActive) {
    throw new AppError(
      403,
      "session_ended",
      "This session has ended and is no longer accepting requests."
    );
  }
  return row;
}


/** The newest active *local* session for a host, or null if none exists. */
export async function selectActiveSession(hostId: string): Promise<SessionRow | null> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.hostId, hostId),
        eq(sessions.isActive, true),
        eq(sessions.source, "local")
      )
    )
    .orderBy(desc(sessions.createdAt))
    .limit(1);
  return row ?? null;
}


// ─────────────────────────────────────────────────────────────────
// Host approval / lifecycle (host-scoped, IDOR-guarded)
// ─────────────────────────────────────────────────────────────────

/** Subquery: session ids owned by this host (IDOR guard for request mutations). */
export function ownedSessionIds(hostId: string) {
  return db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.hostId, hostId));
}


export async function recordEvent(
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
