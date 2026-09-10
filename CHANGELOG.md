# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - September 10, 2026

### Added
- Requester attribution with the portal account photo. Integration submissions
  accept `requesterAvatarUrl` (https only); the stage and room player show it
  next to the requester's name while their track plays.
- `docs/LOVABLE_INTEGRATION_SPEC.md` — portal-side build brief for the Offsite
  integration.

## [0.5.0] - September 9, 2026

### Added
- **AutoDJ** — a room writes its own tracks so it never runs dry. Audience
  requests take priority; AutoDJ only generates the shortfall below its target.
  A per-room brief steers the style (Lovable sends one per agenda item, local
  hosts type their own) and falls back to a house style shaped by the room name,
  session title, and time of day.
- Offsite AutoDJ behaviors: pre-roll when a room goes live, autoplay for idle
  assigned rooms, and wind-down near the end of an agenda block.
- AutoDJ settings in the Integration API (`settings.autoDj`) and a per-room
  AutoDJ toggle in the `/admin/offsite` console.
- `source: "auto"` request tagging for house-generated tracks.

### Changed
- **Renamed the AutoDJ toggle to Auto-approve**, which is what it always did
  (queue guest requests without host approval). `settings.autoDj` in the
  Integration API is now `settings.autoApprove`; AutoDJ is the new self-
  generating behavior.
- Player pairing polls with the secret in a POST body instead of the query
  string, so the device credential never lands in an access log.
- Integration request/playback idempotency keys are scoped per agenda session,
  so a portal driving several rooms can reuse an employee-scoped key.

### Fixed
- Integration clients could assign or unassign any player device by id; they are
  now limited to devices that are free or already in one of their own rooms.
- A skip that lost the revision race no longer leaves a track marked played
  while the room still points at it.
- Skip after a manual track selection advances to the next track instead of
  jumping to the top of the queue.
- Paired players sent a heartbeat every second instead of every five.
- Creating an integration client with an unknown owner host returns 400 instead
  of quietly billing the acting admin.
- A stale `/sign-in?error=domain` tab no longer signs out a valid session.

## [0.4.0] - September 9, 2026

### Added
- **Offsite integration** — concurrent agenda-session rooms for company Offsite,
  with a server-to-server Integration API, paired physical-space players, and a
  dedicated `/admin/offsite` console. See `docs/OFFSITE_INTEGRATION.md`.
- Integration clients with hashed/revocable API credentials.
- Player pairing flow at `/player` (display code + HttpOnly device cookie).
- Revisioned room playback state for cross-device play/pause/skip/select.
- Schema support for external session/request IDs and request source tagging.

### Changed
- Local host sessions still enforce one active room per host; integration-backed
  Offsite sessions may run concurrently under the same owner.
- Stage BroadcastChannel is namespaced by session `publicCode`.
- Stage request QR/link now includes `?code=…`.
- Public guest submissions are rejected when the session has ended.

### Fixed
- Removed the stale localStorage admin-token path from the stage; host cookie
  auth is used for best-effort playback/station-id publishes.

## [0.3.1] - June 30, 2026

### Changed
- Internal refactor only — no behavior change. Broke up the largest files into
  focused modules so the codebase is easier to navigate and maintain: the host
  console split into per-area components (header, files, controls, queue, player,
  DJ booth) and hooks, the 1751-line `queries.ts` split into domain modules,
  `generation.ts` split into lyrics/provider/orchestrator, and shared API route
  helpers extracted.

## [0.3.0] - June 19, 2026

### Added
- **Crossfade** — an opt-in, radio-style overlap between tracks. When a host turns
  it on, the player blends the end of each track into the start of the next
  (songs and station IDs alike) instead of hard-cutting; off, tracks cut cleanly.
  The toggle sits in the host console next to Station ID.
- Station IDs now appear **in the queue** where they'll play — a lead-off jingle
  when the set is stopped, then one after every couple of songs — and the
  placement re-flows live as guests add or remove requests. The host queue shows
  each slot as a "Radio ID" row.
- Hosts can **play a Radio ID on demand** — a play button on each queued jingle
  drops it in immediately, then the set resumes.

### Changed
- Station ID placement is now computed server-side as the single source of truth,
  so the queue you see and the order that plays always match.
- The host's local player reached full parity with the stage — it now plays
  station IDs and crossfades, so playback behaves the same whether or not a stage
  tab is open.

### Fixed
- Restored three corrupted brand font files (KMR Waldenburg Normal/Fett/Halbfett)
  that failed to decode in the browser, so headings render in the brand typeface
  again.

## [0.2.1] - June 19, 2026

### Added
- **Station ID** — an opt-in radio-style identifier. When a host enables it, the
  stage automatically drops a ~10-second AI-generated "ElevenDJ Radio, powered by
  ElevenLabs" jingle in after every 2 songs, then continues to the next track.
  Enabling it also plays one at the next playable point (immediately when idle,
  or right after the current song).
- Station IDs vary each time — generated from an ad-libbed prompt (rotating vibe,
  musical bed, and announcer voice) so no two sound alike.
- Optional personalization: hosts can weave their own or their room's name into
  the jingle via a checkbox + name field in the console; otherwise it stays the
  high-level brand line.
- A warm pool keeps a few station IDs pre-generated and ready so playback never
  stalls, auto-replenishing a fresh variation after each one plays.

### Changed
- Audience requests now carry an internal `kind`, so auto-inserted content
  (station IDs) is kept out of the public queue, queue limits, and the host's
  recent activity feed.

## [0.2.0] - June 15, 2026

### Added
- Generate songs with ElevenLabs **Music v2** by default — the current flagship
  model (richer vocals and arrangement, better multilingual reliability,
  mid-song genre switching). Override per environment with `MUSIC_MODEL`
  (`music_v1` pins the legacy model).
- Optional C2PA content-provenance signing for generated MP3s via the
  `MUSIC_SIGN_C2PA` env flag.
- `MUSIC_STORE_FOR_INPAINTING` env to opt into server-side retention of
  generated songs (default off) so their `song_id` can be reused for a future
  remix/inpainting feature.
- A tracked `.env.example` documenting the music generation env vars.

### Changed
- Word-synced karaoke now parses both Music v1 (`sections`) and Music v2
  (`chunks`) composition plans, so lyrics render and highlight regardless of the
  generating model.
- Upgraded `@elevenlabs/elevenlabs-js` to `^2.53.0`.
- Hardened generation error handling: surface ElevenLabs 422 validation
  messages and map 401/403/429 to clear, specific failure reasons.
- `MUSIC_OUTPUT_FORMAT` is validated against the supported mp3 formats; an
  unknown value is ignored (with a warning) instead of failing generation.
- Lyric alignment logs when it falls back from word-level timing (the
  divergence guard) instead of doing so silently.

## [0.1.1] - June 05, 2026

### Added
- Admin blob storage panel at `/admin`: total and orphan usage stats, a
  paginated file browser with host/session attribution, per-file delete, and
  one-click cleanup of orphaned audio. Scoped to the `tracks/` namespace.

### Fixed
- Delete a track's stale audio blob when it is requeued, so regenerated tracks
  no longer leave orphaned files in storage.

## [0.1.0] - June 05, 2026

### Added
- Multi-tenant hosting on Neon Postgres + Neon Auth: every host runs an
  independent room with its own sessions, settings, and public request link.
- Session management: list, rename, switch the live session, and delete past
  sessions from the host console.
- Superadmin user management at `/admin`: view all users with session/track
  rollups, grant/revoke admin (self-demotion blocked), and launch the stage
  for any user's live session to listen along.
- Public request line, fullscreen stage (audio + big screen), QR request links,
  AutoDJ and approval modes, host DJ booth, and reactive orb colorways.

### Changed
- Migrated off Supabase to Neon Postgres (Drizzle ORM) with polling-based
  realtime in place of Supabase Realtime.

### Fixed
- Prevent duplicate active sessions per host via a one-active-per-host
  constraint and a race-safe session resolver.
