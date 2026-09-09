import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { Lyrics } from "@/lib/status";

/**
 * App-side mirror of the Neon Auth user. Every host who signs in is
 * auto-provisioned a row here (see getCurrentUser), so all activity is
 * attributable and sessions can be owned by a stable local id.
 */
export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  neonAuthId: text("neon_auth_id"),
  displayName: text("display_name"),
  // Superadmin flag. Source of truth for cross-tenant access; the ADMIN_EMAILS
  // env var is only a bootstrap fallback (see getCurrentUser). Never clobbered
  // by upsertUser on sign-in.
  isAdmin: boolean("is_admin").notNull().default(false),
  // Per-host ElevenLabs API key, encrypted at rest (AES-256-GCM; see
  // src/lib/crypto.ts). The ciphertext is never sent to the client — only the
  // masked `hint` (last 4 chars) and `addedAt` surface in the host console.
  elevenlabsKeyCiphertext: text("elevenlabs_key_ciphertext"),
  elevenlabsKeyHint: text("elevenlabs_key_hint"),
  elevenlabsKeyAddedAt: timestamp("elevenlabs_key_added_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Server-to-server API clients (e.g. Lovable Offsite portal). Credentials are
 * hashed at rest; only a short prefix is logged/displayed.
 */
export const integrationClients = pgTable(
  "integration_clients",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    // Host whose ElevenLabs key funds generation for this client's sessions.
    ownerHostId: uuid("owner_host_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialHash: text("credential_hash").notNull(),
    credentialPrefix: text("credential_prefix").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("integration_clients_owner_idx").on(table.ownerHostId),
    uniqueIndex("integration_clients_prefix_idx").on(table.credentialPrefix),
  ]
);

/**
 * A DJ session owned by a host. Settings and playback that used to live in the
 * global `playlist_settings` / `playback_state` singletons are folded in here
 * so every host runs an independent room. `public_code` is the unguessable
 * capability slug behind a session's request link/QR — regenerating it issues a
 * fresh link and invalidates the old one.
 *
 * `source` distinguishes host-console local rooms from integration-backed
 * Offsite agenda sessions. Local hosts still have at most one active session;
 * integration sessions may run concurrently under the same owner.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicCode: text("public_code")
      .notNull()
      .unique()
      .default(sql`encode(gen_random_bytes(6), 'hex')`),
    // "local" = host console; "integration" = Offsite agenda session.
    source: text("source").notNull().default("local"),
    integrationClientId: uuid("integration_client_id").references(
      () => integrationClients.id,
      { onDelete: "set null" }
    ),
    externalSessionId: text("external_session_id"),
    externalRevision: text("external_revision"),
    roomName: text("room_name"),
    agendaStartsAt: timestamp("agenda_starts_at", { withTimezone: true }),
    agendaEndsAt: timestamp("agenda_ends_at", { withTimezone: true }),
    externalMetadata: jsonb("external_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Per-session settings (previously global singletons).
    requestsOpen: boolean("requests_open").notNull().default(true),
    // Incoming guest requests queue straight away instead of waiting for the
    // host to approve them. (This is what the old `auto_dj` column meant.)
    autoApprove: boolean("auto_approve").notNull().default(true),
    // AutoDJ: the room generates its own tracks so it never runs dry. `brief`
    // is the vibe instruction — Lovable sends one per agenda item, local hosts
    // type their own; without it we fall back to house ad-libs. `autoplay`
    // lets an idle room with ready audio start itself (unattended rooms).
    autoDjEnabled: boolean("auto_dj_enabled").notNull().default(false),
    autoDjTarget: integer("auto_dj_target").notNull().default(2),
    autoDjBrief: text("auto_dj_brief"),
    autoDjAutoplay: boolean("auto_dj_autoplay").notNull().default(true),
    defaultDurationMs: integer("default_duration_ms").notNull().default(60000),
    forceInstrumental: boolean("force_instrumental").notNull().default(true),
    // Selected orb gradient colorway (see src/components/orb/colorways.ts).
    // Stored as the colorway name; validated against the registry allowlist at
    // the settings API before it's written.
    orbColorway: text("orb_colorway").notNull().default("creative-1"),
    // Host-controlled master playback volume (0..1) for the room. Edited only
    // by the authenticated host (settings API); the public stage screen reads
    // it from the queue snapshot and obeys it live — listeners can't change it.
    masterVolume: real("master_volume").notNull().default(1),
    maxPendingRequests: integer("max_pending_requests").notNull().default(25),
    maxReadyQueue: integer("max_ready_queue").notNull().default(50),
    // Station ID: when on, the stage auto-plays a short AI "radio ID" jingle
    // after every couple of songs (see src/lib/station-id.ts). When
    // `stationIdPersonalize` is on and a non-empty `stationIdHostName` is set,
    // the host/room name is woven into the jingle; otherwise it stays the
    // high-level brand line. Integration sessions keep this off in the MVP.
    stationIdEnabled: boolean("station_id_enabled").notNull().default(false),
    stationIdPersonalize: boolean("station_id_personalize")
      .notNull()
      .default(false),
    stationIdHostName: text("station_id_host_name"),
    // Crossfade: when on, the stage overlaps track ends with the next track's
    // start (radio-style) instead of hard-cutting. Stage-only behavior.
    crossfadeEnabled: boolean("crossfade_enabled").notNull().default(false),
    // Per-session playback state.
    currentRequestId: uuid("current_request_id").references(
      (): AnyPgColumn => songRequests.id,
      { onDelete: "set null" }
    ),
    isPlaying: boolean("is_playing").notNull().default(false),
    playbackStartedAt: timestamp("playback_started_at", {
      withTimezone: true,
    }),
    // Canonical paused/resume position for remote players (ms into the track).
    playbackPositionMs: integer("playback_position_ms").notNull().default(0),
    // Monotonic revision for optimistic concurrency across admin/player devices.
    playbackRevision: bigint("playback_revision", { mode: "number" })
      .notNull()
      .default(0),
    playbackUpdatedAt: timestamp("playback_updated_at", {
      withTimezone: true,
    }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sessions_host_idx").on(table.hostId, table.createdAt),
    index("sessions_public_code_idx").on(table.publicCode),
    index("sessions_integration_idx").on(
      table.integrationClientId,
      table.externalSessionId
    ),
    // At most one active *local* session per host. Integration-backed Offsite
    // agenda sessions may run concurrently under the same owner host.
    uniqueIndex("sessions_one_active_local_per_host")
      .on(table.hostId)
      .where(sql`${table.isActive} and ${table.source} = 'local'`),
    uniqueIndex("sessions_external_id_idx")
      .on(table.integrationClientId, table.externalSessionId)
      .where(sql`${table.externalSessionId} is not null`),
    check(
      "sessions_source_check",
      sql`${table.source} in ('local','integration')`
    ),
    check(
      "sessions_duration_check",
      sql`${table.defaultDurationMs} between 3000 and 300000`
    ),
    check(
      "sessions_master_volume_check",
      sql`${table.masterVolume} between 0 and 1`
    ),
    check(
      "sessions_auto_dj_target_check",
      sql`${table.autoDjTarget} between 1 and 5`
    ),
    check(
      "sessions_playback_position_check",
      sql`${table.playbackPositionMs} >= 0`
    ),
  ]
);

export const songRequests = pgTable(
  "song_requests",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    clientTokenHash: text("client_token_hash").notNull(),
    requesterName: text("requester_name"),
    // Discriminates a normal audience request from an auto-inserted generated
    // interstitial (currently just "station_id"). Generic on purpose so future
    // auto-inserted content reuses the same pipeline. Station IDs share this
    // table but are excluded from the public queue and request-scoped limits.
    kind: text("kind").notNull().default("request"),
    // Origin of the request: public guest form, host console, or integration API.
    source: text("source").notNull().default("guest"),
    integrationClientId: uuid("integration_client_id").references(
      () => integrationClients.id,
      { onDelete: "set null" }
    ),
    externalRequestId: text("external_request_id"),
    prompt: text("prompt").notNull(),
    normalizedPrompt: text("normalized_prompt").notNull(),
    status: text("status").notNull().default("pending"),
    position: integer("position"),
    durationMs: integer("duration_ms").notNull().default(60000),
    audioUrl: text("audio_url"),
    blobPath: text("blob_path"),
    // ElevenLabs song id (from the `song-id` response header). Retained for a
    // future remix/inpainting feature; only usable for inpainting when the song
    // was stored via storeForInpainting (see MUSIC_STORE_FOR_INPAINTING).
    songId: text("song_id"),
    promptSuggestion: text("prompt_suggestion"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    ipHash: text("ip_hash"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    generationAttempts: integer("generation_attempts").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    forceInstrumental: boolean("force_instrumental").notNull().default(false),
    lyrics: jsonb("lyrics").$type<Lyrics | null>(),
    title: text("title"),
    isExplicit: boolean("is_explicit").notNull().default(false),
  },
  (table) => [
    index("song_requests_session_status_idx").on(
      table.sessionId,
      table.status,
      table.position,
      table.createdAt
    ),
    index("song_requests_ip_created_idx").on(table.ipHash, table.createdAt),
    index("song_requests_normalized_idx").on(
      table.sessionId,
      table.normalizedPrompt,
      table.createdAt
    ),
    uniqueIndex("song_requests_external_id_idx")
      .on(table.sessionId, table.integrationClientId, table.externalRequestId)
      .where(sql`${table.externalRequestId} is not null`),
    check(
      "song_requests_status_check",
      sql`${table.status} in ('pending','queued','generating','ready','rejected','failed','played','archived')`
    ),
    check(
      "song_requests_duration_check",
      sql`${table.durationMs} between 3000 and 300000`
    ),
    check(
      "song_requests_kind_check",
      sql`${table.kind} in ('request','station_id')`
    ),
    check(
      "song_requests_source_check",
      sql`${table.source} in ('guest','host','integration','auto')`
    ),
  ]
);

export const requestEvents = pgTable("request_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  requestId: uuid("request_id").references(() => songRequests.id, {
    onDelete: "cascade",
  }),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Short-lived player pairing attempts. The short display code identifies the
 * device to an admin; authentication uses a separate high-entropy secret.
 */
export const playerPairings = pgTable(
  "player_pairings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    displayCode: text("display_code").notNull(),
    credentialHash: text("credential_hash").notNull(),
    credentialPrefix: text("credential_prefix").notNull(),
    deviceName: text("device_name").notNull(),
    ipHash: text("ip_hash"),
    status: text("status").notNull().default("pending"),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    index("player_pairings_status_idx").on(table.status, table.expiresAt),
    uniqueIndex("player_pairings_display_pending_idx")
      .on(table.displayCode)
      .where(sql`${table.status} = 'pending'`),
    check(
      "player_pairings_status_check",
      sql`${table.status} in ('pending','approved','rejected','expired')`
    ),
  ]
);

/**
 * Authenticated physical-space players. The credential is set once at pairing
 * approval and never returned again; reassignment changes `sessionId` only.
 */
export const playerDevices = pgTable(
  "player_devices",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    pairingId: uuid("pairing_id").references(() => playerPairings.id, {
      onDelete: "set null",
    }),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    credentialHash: text("credential_hash").notNull(),
    credentialPrefix: text("credential_prefix").notNull(),
    status: text("status").notNull().default("active"),
    pairedBy: uuid("paired_by").references(() => users.id, {
      onDelete: "set null",
    }),
    pairedAt: timestamp("paired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    reportedRequestId: uuid("reported_request_id"),
    reportedRevision: bigint("reported_revision", { mode: "number" }),
    reportedIsPlaying: boolean("reported_is_playing"),
    reportedPositionMs: integer("reported_position_ms"),
    audioUnlocked: boolean("audio_unlocked").notNull().default(false),
    lastError: text("last_error"),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("player_devices_session_idx").on(table.sessionId, table.status),
    uniqueIndex("player_devices_prefix_idx").on(table.credentialPrefix),
    check(
      "player_devices_status_check",
      sql`${table.status} in ('active','revoked')`
    ),
  ]
);

/**
 * Playback command / report audit ledger. Also stores idempotent mutation
 * results for admin, integration, and player actors.
 */
export const playbackEvents = pgTable(
  "playback_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    idempotencyKey: text("idempotency_key"),
    expectedRevision: bigint("expected_revision", { mode: "number" }),
    appliedRevision: bigint("applied_revision", { mode: "number" }),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("playback_events_session_idx").on(table.sessionId, table.createdAt),
    uniqueIndex("playback_events_idempotency_idx")
      .on(table.sessionId, table.actorType, table.actorId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check(
      "playback_events_actor_check",
      sql`${table.actorType} in ('admin','integration','player','local')`
    ),
  ]
);

export type UserRow = typeof users.$inferSelect;
export type IntegrationClientRow = typeof integrationClients.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SongRequestRow = typeof songRequests.$inferSelect;
export type RequestEventRow = typeof requestEvents.$inferSelect;
export type PlayerPairingRow = typeof playerPairings.$inferSelect;
export type PlayerDeviceRow = typeof playerDevices.$inferSelect;
export type PlaybackEventRow = typeof playbackEvents.$inferSelect;
