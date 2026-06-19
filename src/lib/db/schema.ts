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
 * A DJ session owned by a host. Settings and playback that used to live in the
 * global `playlist_settings` / `playback_state` singletons are folded in here
 * so every host runs an independent room. `public_code` is the unguessable
 * capability slug behind a session's request link/QR — regenerating it issues a
 * fresh link and invalidates the old one.
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
    // Per-session settings (previously global singletons).
    requestsOpen: boolean("requests_open").notNull().default(true),
    autoDj: boolean("auto_dj").notNull().default(true),
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
    // high-level brand line.
    stationIdEnabled: boolean("station_id_enabled").notNull().default(false),
    stationIdPersonalize: boolean("station_id_personalize")
      .notNull()
      .default(false),
    stationIdHostName: text("station_id_host_name"),
    // Per-session playback state.
    currentRequestId: uuid("current_request_id").references(
      (): AnyPgColumn => songRequests.id,
      { onDelete: "set null" }
    ),
    isPlaying: boolean("is_playing").notNull().default(false),
    playbackStartedAt: timestamp("playback_started_at", {
      withTimezone: true,
    }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("sessions_host_idx").on(table.hostId, table.createdAt),
    index("sessions_public_code_idx").on(table.publicCode),
    // At most one active session per host. The select-or-insert path in
    // getActiveSessionForHost can race under concurrent first-load requests;
    // this partial unique index turns the loser's INSERT into a 23505 it
    // recovers from instead of silently spawning a duplicate active session.
    uniqueIndex("sessions_one_active_per_host")
      .on(table.hostId)
      .where(sql`${table.isActive}`),
    check(
      "sessions_duration_check",
      sql`${table.defaultDurationMs} between 3000 and 300000`
    ),
    check(
      "sessions_master_volume_check",
      sql`${table.masterVolume} between 0 and 1`
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

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SongRequestRow = typeof songRequests.$inferSelect;
export type RequestEventRow = typeof requestEvents.$inferSelect;
