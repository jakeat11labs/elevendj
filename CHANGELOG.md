# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
