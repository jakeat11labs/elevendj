# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
