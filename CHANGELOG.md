# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
