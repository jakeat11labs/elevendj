import "server-only";

import { del } from "@vercel/blob";

import { AppError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  Lyrics,
  NowPlaying,
  QueueItem,
  QueueSnapshot,
  RequestStatus,
  Session,
} from "@/lib/status";
import { REALTIME_TOPIC, REQUEST_STATUSES } from "@/lib/status";
import {
  generateClientToken,
  hashValue,
  normalizePrompt,
  type RequestInput,
} from "@/lib/security";

export type SongRequestRecord = {
  id: string;
  client_token_hash: string;
  requester_name: string | null;
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

type PlaylistSettings = {
  requests_open: boolean;
  auto_dj: boolean;
  max_pending_requests: number;
  max_ready_queue: number;
  default_duration_ms: number;
  force_instrumental: boolean;
};

type SessionRecord = {
  id: string;
  name: string;
  created_at: string;
  ended_at: string | null;
  is_active: boolean;
};

type PlaybackStateRecord = {
  id: boolean;
  current_request_id: string | null;
  is_playing: boolean;
  started_at: string | null;
  updated_at: string | null;
};

const activeStatuses: RequestStatus[] = [
  "pending",
  "queued",
  "generating",
  "ready",
];

function mapSession(row: SessionRecord, trackCount?: number): Session {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    isActive: row.is_active,
    ...(trackCount === undefined ? {} : { trackCount }),
  };
}

function databaseUnavailable(error: { message?: string }) {
  console.error("Supabase operation failed", error);
  return new AppError(
    503,
    "database_unavailable",
    "The request line is unavailable. Try again shortly."
  );
}

function mapQueueItem(row: SongRequestRecord): QueueItem {
  return {
    id: row.id,
    requesterName: row.requester_name,
    prompt: row.prompt,
    status: row.status,
    position: row.position,
    durationMs: row.duration_ms,
    audioUrl: row.audio_url,
    title: row.title ?? null,
    isExplicit: row.is_explicit ?? false,
    promptSuggestion: row.prompt_suggestion,
    errorMessage: row.error_message,
    lyrics: row.lyrics ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function getPlaylistSettings(): Promise<PlaylistSettings> {
  const { data, error } = await getSupabaseAdmin()
    .from("playlist_settings")
    .select(
      "requests_open,auto_dj,max_pending_requests,max_ready_queue,default_duration_ms,force_instrumental"
    )
    .eq("id", true)
    .single();

  if (error) {
    throw databaseUnavailable(error);
  }

  return data as PlaylistSettings;
}

export async function getActiveSession(): Promise<Session> {
  const { data, error } = await getSupabaseAdmin()
    .from("sessions")
    .select("id,name,created_at,ended_at,is_active")
    .eq("is_active", true)
    .limit(1);

  if (error) {
    throw databaseUnavailable(error);
  }

  if (data && data.length > 0) {
    return mapSession(data[0] as SessionRecord);
  }

  const { data: created, error: insertError } = await getSupabaseAdmin()
    .from("sessions")
    .insert({ name: "Session 1", is_active: true })
    .select("id,name,created_at,ended_at,is_active")
    .single();

  if (insertError || !created) {
    throw databaseUnavailable(insertError ?? { message: "getActiveSession failed" });
  }

  return mapSession(created as SessionRecord);
}

export async function createSession(name?: string): Promise<Session> {
  const { error: deactivateError } = await getSupabaseAdmin()
    .from("sessions")
    .update({ is_active: false, ended_at: new Date().toISOString() })
    .eq("is_active", true);

  if (deactivateError) {
    throw databaseUnavailable(deactivateError);
  }

  let sessionName = name?.trim();
  if (!sessionName) {
    const { count, error: countError } = await getSupabaseAdmin()
      .from("sessions")
      .select("id", { count: "exact", head: true });

    if (countError) {
      throw databaseUnavailable(countError);
    }

    sessionName = `Session ${(count ?? 0) + 1}`;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("sessions")
    .insert({ name: sessionName, is_active: true })
    .select("id,name,created_at,ended_at,is_active")
    .single();

  if (error || !data) {
    throw databaseUnavailable(error ?? { message: "createSession failed" });
  }

  await setPlaybackState(null, false);

  return mapSession(data as SessionRecord);
}

export async function listSessions(): Promise<Session[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("sessions")
    .select("id,name,created_at,ended_at,is_active")
    .order("created_at", { ascending: false });

  if (error) {
    throw databaseUnavailable(error);
  }

  const sessions = (data || []) as SessionRecord[];

  return Promise.all(
    sessions.map(async (row) => {
      const { count, error: countError } = await getSupabaseAdmin()
        .from("song_requests")
        .select("id", { count: "exact", head: true })
        .eq("session_id", row.id)
        .not("audio_url", "is", null);

      if (countError) {
        throw databaseUnavailable(countError);
      }

      return mapSession(row, count ?? 0);
    })
  );
}

export async function setPlaybackState(
  requestId: string | null,
  isPlaying: boolean
): Promise<void> {
  const update: Record<string, unknown> = {
    id: true,
    current_request_id: requestId,
    is_playing: isPlaying,
    updated_at: new Date().toISOString(),
  };

  if (isPlaying) {
    update.started_at = new Date().toISOString();
  }

  const { error } = await getSupabaseAdmin()
    .from("playback_state")
    .upsert(update, { onConflict: "id" });

  if (error) {
    throw databaseUnavailable(error);
  }
}

export async function getNowPlaying(): Promise<NowPlaying> {
  const settings = await getPlaylistSettings();
  const requestsOpen = settings.requests_open;
  const autoDj = settings.auto_dj;

  const { data, error } = await getSupabaseAdmin()
    .from("playback_state")
    .select("id,current_request_id,is_playing,started_at,updated_at")
    .eq("id", true)
    .limit(1);

  if (error) {
    throw databaseUnavailable(error);
  }

  const state = (data?.[0] as PlaybackStateRecord | undefined) ?? null;

  if (!state || !state.current_request_id) {
    return { isPlaying: false, requestsOpen, autoDj, track: null };
  }

  const { data: requestRow, error: requestError } = await getSupabaseAdmin()
    .from("song_requests")
    .select("id,prompt,requester_name,status")
    .eq("id", state.current_request_id)
    .single();

  if (requestError || !requestRow) {
    return { isPlaying: state.is_playing, requestsOpen, autoDj, track: null };
  }

  const row = requestRow as Pick<
    SongRequestRecord,
    "id" | "prompt" | "requester_name" | "status"
  >;

  return {
    isPlaying: state.is_playing,
    requestsOpen,
    autoDj,
    track: {
      id: row.id,
      prompt: row.prompt,
      requesterName: row.requester_name,
      status: row.status,
    },
  };
}

export async function setRequestsOpen(open: boolean): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("playlist_settings")
    .update({ requests_open: open })
    .eq("id", true);

  if (error) {
    throw databaseUnavailable(error);
  }
}

export async function setAutoDj(autoDj: boolean): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("playlist_settings")
    .update({ auto_dj: autoDj })
    .eq("id", true);

  if (error) {
    throw databaseUnavailable(error);
  }
}

/**
 * Approve a `pending` request so generation can start. Returns the updated
 * record, or null if the request was no longer pending (e.g. already approved
 * by another tab). The caller is responsible for kicking off generation.
 */
export async function approveRequest(
  id: string
): Promise<SongRequestRecord | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("song_requests")
    .update({
      status: "queued",
      error_code: null,
      error_message: null,
      prompt_suggestion: null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .single();

  if (error || !data) {
    return null;
  }

  await recordEvent(id, "request_approved", {});

  return data as SongRequestRecord;
}

export async function getQueueSnapshot(): Promise<QueueSnapshot> {
  const activeSession = await getActiveSession();
  const [settings, requests] = await Promise.all([
    getPlaylistSettings(),
    getSupabaseAdmin()
      .from("song_requests")
      .select(
        "id,client_token_hash,requester_name,prompt,normalized_prompt,status,position,duration_ms,audio_url,blob_path,song_id,prompt_suggestion,error_code,error_message,ip_hash,idempotency_key,generation_attempts,started_at,completed_at,created_at,updated_at,metadata,force_instrumental,lyrics,title,is_explicit"
      )
      .eq("session_id", activeSession.id)
      .in("status", activeStatuses)
      .order("position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
  ]);

  if (requests.error) {
    throw databaseUnavailable(requests.error);
  }

  const counts = Object.fromEntries(
    REQUEST_STATUSES.map((status) => [status, 0])
  ) as Record<RequestStatus, number>;

  const items = ((requests.data || []) as SongRequestRecord[]).map((row) => {
    counts[row.status] += 1;
    return mapQueueItem(row);
  });

  return {
    topic: REALTIME_TOPIC,
    requestsOpen: settings.requests_open,
    autoDj: settings.auto_dj,
    defaultDurationMs: settings.default_duration_ms,
    forceInstrumental: settings.force_instrumental,
    items,
    counts,
  };
}

export async function getAdminOverview() {
  const [settings, queue, recent, files, sessions] = await Promise.all([
    getPlaylistSettings(),
    getQueueSnapshot(),
    getSupabaseAdmin()
      .from("song_requests")
      .select(
        "id,client_token_hash,requester_name,prompt,normalized_prompt,status,position,duration_ms,audio_url,blob_path,song_id,prompt_suggestion,error_code,error_message,ip_hash,idempotency_key,generation_attempts,started_at,completed_at,created_at,updated_at,metadata,force_instrumental,lyrics,title,is_explicit"
      )
      .order("created_at", { ascending: false })
      .limit(75),
    listFiles(),
    listSessions(),
  ]);

  if (recent.error) {
    throw databaseUnavailable(recent.error);
  }

  return {
    settings,
    queue,
    recent: ((recent.data || []) as SongRequestRecord[]).map(mapQueueItem),
    files,
    sessions,
  };
}

export async function createSongRequest(input: RequestInput, ipHash: string) {
  const settings = await getPlaylistSettings();

  if (!settings.requests_open) {
    throw new AppError(403, "requests_closed", "The request line is closed.");
  }

  const activeSession = await getActiveSession();

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count: recentCount, error: countError } = await getSupabaseAdmin()
    .from("song_requests")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  if (countError) {
    throw databaseUnavailable(countError);
  }

  if ((recentCount ?? 0) >= 3) {
    throw new AppError(
      429,
      "rate_limited",
      "Too many requests from this connection. Wait a few minutes before sending another."
    );
  }

  const { count: activeCount, error: activeError } = await getSupabaseAdmin()
    .from("song_requests")
    .select("id", { count: "exact", head: true })
    .eq("session_id", activeSession.id)
    .in("status", activeStatuses);

  if (activeError) {
    throw databaseUnavailable(activeError);
  }

  if ((activeCount ?? 0) >= settings.max_pending_requests) {
    throw new AppError(
      409,
      "queue_full",
      "The queue is full right now. Try again after the next track starts."
    );
  }

  const normalizedPrompt = normalizePrompt(input.prompt);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: duplicate, error: duplicateError } = await getSupabaseAdmin()
    .from("song_requests")
    .select("id,status")
    .eq("session_id", activeSession.id)
    .eq("normalized_prompt", normalizedPrompt)
    .in("status", activeStatuses)
    .gte("created_at", dayAgo)
    .limit(1);

  if (duplicateError) {
    throw databaseUnavailable(duplicateError);
  }

  if (duplicate && duplicate.length > 0) {
    throw new AppError(
      409,
      "duplicate_prompt",
      "That request is already in the queue."
    );
  }

  const { data: lastPosition, error: positionError } = await getSupabaseAdmin()
    .from("song_requests")
    .select("position")
    .not("position", "is", null)
    .order("position", { ascending: false })
    .limit(1);

  if (positionError) {
    throw databaseUnavailable(positionError);
  }

  const clientToken = generateClientToken();
  const tokenHash = hashValue(clientToken, "client-token");
  const nextPosition = Number(lastPosition?.[0]?.position ?? 0) + 1;

  // AutoDJ generates immediately (`queued`); approval mode holds the request in
  // `pending` until the host approves it.
  const initialStatus: RequestStatus = settings.auto_dj ? "queued" : "pending";

  const { data, error } = await getSupabaseAdmin()
    .from("song_requests")
    .insert({
      client_token_hash: tokenHash,
      requester_name: input.requesterName ?? null,
      prompt: input.prompt,
      normalized_prompt: normalizedPrompt,
      status: initialStatus,
      position: nextPosition,
      duration_ms: settings.default_duration_ms,
      force_instrumental: input.instrumental ?? false,
      ip_hash: ipHash,
      session_id: activeSession.id,
      idempotency_key: hashValue(`${ipHash}:${normalizedPrompt}:${Date.now()}`, "idempotency"),
    })
    .select()
    .single();

  if (error) {
    throw databaseUnavailable(error);
  }

  await recordEvent(data.id, "request_created", { position: nextPosition });

  return {
    request: data as SongRequestRecord,
    clientToken,
  };
}

export async function getRequestByClientToken(id: string, clientToken: string) {
  const tokenHash = hashValue(clientToken, "client-token");
  const { data, error } = await getSupabaseAdmin()
    .from("song_requests")
    .select(
      "id,client_token_hash,requester_name,prompt,normalized_prompt,status,position,duration_ms,audio_url,blob_path,song_id,prompt_suggestion,error_code,error_message,ip_hash,idempotency_key,generation_attempts,started_at,completed_at,created_at,updated_at,metadata,force_instrumental,lyrics,title,is_explicit"
    )
    .eq("id", id)
    .eq("client_token_hash", tokenHash)
    .single();

  if (error || !data) {
    throw new AppError(404, "request_not_found", "No request matched that token.");
  }

  return mapQueueItem(data as SongRequestRecord);
}

export async function claimRequestForGeneration(id: string) {
  const { data: existing, error: readError } = await getSupabaseAdmin()
    .from("song_requests")
    .select(
      "id,client_token_hash,requester_name,prompt,normalized_prompt,status,position,duration_ms,audio_url,blob_path,song_id,prompt_suggestion,error_code,error_message,ip_hash,idempotency_key,generation_attempts,started_at,completed_at,created_at,updated_at,metadata,force_instrumental,lyrics,title,is_explicit"
    )
    .eq("id", id)
    .single();

  if (readError || !existing) {
    return null;
  }

  const request = existing as SongRequestRecord;
  if (request.status === "ready" || request.status === "generating") {
    return null;
  }

  if (request.status !== "queued") {
    return null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("song_requests")
    .update({
      status: "generating",
      generation_attempts: request.generation_attempts + 1,
      started_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
      prompt_suggestion: null,
    })
    .eq("id", id)
    .eq("status", "queued")
    .select()
    .single();

  if (error || !data) {
    return null;
  }

  await recordEvent(id, "generation_started", {
    attempt: request.generation_attempts + 1,
  });

  return data as SongRequestRecord;
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
  const { error } = await getSupabaseAdmin()
    .from("song_requests")
    .update({
      status: "ready",
      audio_url: audioUrl,
      blob_path: blobPath,
      song_id: songId,
      lyrics,
      title: meta.title ?? null,
      is_explicit: meta.isExplicit ?? false,
      // genres/languages/description live in the metadata jsonb column.
      ...(meta.songMetadata ? { metadata: meta.songMetadata } : {}),
      completed_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    })
    .eq("id", id);

  if (error) {
    throw databaseUnavailable(error);
  }

  await recordEvent(id, "generation_completed", {
    audioUrl,
    songId,
    title: meta.title ?? null,
  });
}

export async function markRequestFailed(
  id: string,
  code: string,
  message: string,
  suggestion?: string
) {
  const status: RequestStatus = code === "bad_prompt" ? "rejected" : "failed";
  const { error } = await getSupabaseAdmin()
    .from("song_requests")
    .update({
      status,
      error_code: code,
      error_message: message,
      prompt_suggestion: suggestion ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw databaseUnavailable(error);
  }

  await recordEvent(id, status === "rejected" ? "request_rejected" : "generation_failed", {
    code,
    message,
    suggestion,
  });
}

export async function markRequestPlayed(id: string) {
  const { error } = await getSupabaseAdmin()
    .from("song_requests")
    .update({ status: "played" })
    .eq("id", id);

  if (error) {
    throw databaseUnavailable(error);
  }

  await recordEvent(id, "request_played", {});
}

export async function requeueRequest(id: string) {
  const { error } = await getSupabaseAdmin()
    .from("song_requests")
    .update({
      status: "queued",
      audio_url: null,
      blob_path: null,
      song_id: null,
      title: null,
      is_explicit: false,
      error_code: null,
      error_message: null,
      prompt_suggestion: null,
      completed_at: null,
      started_at: null,
    })
    .eq("id", id);

  if (error) {
    throw databaseUnavailable(error);
  }

  await recordEvent(id, "request_requeued", {});
}

export async function rejectRequest(id: string, reason = "Rejected by DJ.") {
  const { error } = await getSupabaseAdmin()
    .from("song_requests")
    .update({
      status: "rejected",
      error_code: "admin_rejected",
      error_message: reason,
      completed_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw databaseUnavailable(error);
  }

  await recordEvent(id, "request_rejected", { reason });
}

export async function removeFromQueue(id: string): Promise<QueueItem> {
  const { data, error } = await getSupabaseAdmin()
    .from("song_requests")
    .update({ status: "archived", position: null })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    throw databaseUnavailable(error ?? { message: "removeFromQueue failed" });
  }

  await recordEvent(id, "request_archived", {});

  return mapQueueItem(data as SongRequestRecord);
}

export async function addToQueue(id: string): Promise<QueueItem> {
  const { data: maxPosition, error: maxError } = await getSupabaseAdmin()
    .from("song_requests")
    .select("position")
    .eq("status", "ready")
    .not("position", "is", null)
    .order("position", { ascending: false })
    .limit(1);

  if (maxError) {
    throw databaseUnavailable(maxError);
  }

  const nextPosition = Number(maxPosition?.[0]?.position ?? 0) + 1;

  const { data, error } = await getSupabaseAdmin()
    .from("song_requests")
    .update({ status: "ready", position: nextPosition })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    throw databaseUnavailable(error ?? { message: "addToQueue failed" });
  }

  await recordEvent(id, "request_queued", { position: nextPosition });

  return mapQueueItem(data as SongRequestRecord);
}

export async function deleteRequest(id: string): Promise<{ ok: true }> {
  const { data, error } = await getSupabaseAdmin()
    .from("song_requests")
    .select("audio_url")
    .eq("id", id)
    .single();

  if (error || !data) {
    throw databaseUnavailable(error ?? { message: "deleteRequest failed" });
  }

  const audioUrl = (data as { audio_url: string | null }).audio_url;
  if (audioUrl) {
    await del(audioUrl);
  }

  const { error: deleteError } = await getSupabaseAdmin()
    .from("song_requests")
    .delete()
    .eq("id", id);

  if (deleteError) {
    throw databaseUnavailable(deleteError);
  }

  return { ok: true };
}

export async function reorderQueue(orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i += 1) {
    const { error } = await getSupabaseAdmin()
      .from("song_requests")
      .update({ position: i + 1 })
      .eq("id", orderedIds[i]);

    if (error) {
      throw databaseUnavailable(error);
    }
  }
}

export async function listFiles(sessionId?: string): Promise<QueueItem[]> {
  let query = getSupabaseAdmin()
    .from("song_requests")
    .select(
      "id,client_token_hash,requester_name,prompt,normalized_prompt,status,position,duration_ms,audio_url,blob_path,song_id,prompt_suggestion,error_code,error_message,ip_hash,idempotency_key,generation_attempts,started_at,completed_at,created_at,updated_at,metadata,force_instrumental,lyrics,title,is_explicit"
    )
    .not("audio_url", "is", null);

  if (sessionId !== "all") {
    const targetSessionId = sessionId ?? (await getActiveSession()).id;
    query = query.eq("session_id", targetSessionId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw databaseUnavailable(error);
  }

  return ((data || []) as SongRequestRecord[]).map(mapQueueItem);
}

export async function bulkAction(
  action: "delete" | "remove_from_queue" | "add_to_queue",
  ids: string[]
): Promise<number> {
  let count = 0;

  for (const id of ids) {
    if (action === "delete") {
      await deleteRequest(id);
    } else if (action === "remove_from_queue") {
      await removeFromQueue(id);
    } else {
      await addToQueue(id);
    }
    count += 1;
  }

  return count;
}

async function recordEvent(
  requestId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  const { error } = await getSupabaseAdmin().from("request_events").insert({
    request_id: requestId,
    event_type: eventType,
    payload,
  });

  if (error) {
    console.error("Failed to record request event", error);
  }
}
