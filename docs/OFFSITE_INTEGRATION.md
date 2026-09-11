# Offsite Integration API

ElevenDJ exposes a server-to-server Integration API so the Lovable Offsite portal
can manage agenda-session music rooms, submit song requests, assign physical
players, and issue playback commands.

This is the endpoint reference. For the portal-side build brief — call sequence,
error handling, and what the portal owns — see `docs/LOVABLE_INTEGRATION_SPEC.md`.

**Do not call these endpoints from a browser.** Keep the integration secret in a
Lovable Edge Function / server route only. There is no CORS grant for this API.

## Setup (ElevenDJ)

1. Sign in as a superadmin and open `/admin/offsite`.
2. Create an **Integration API key**. Copy the secret immediately
   (`edj_live_<prefix>.<secret>`) — it is shown once.
3. Optional: set `AUTH_TOKEN_PEPPER` (falls back to `NEON_AUTH_COOKIE_SECRET`).
4. Apply schema changes:

   ```bash
   # Prefer a Neon development branch first
   pnpm drizzle-kit push
   ```

5. Pair physical players at `/player` and approve them in `/admin/offsite`.

## Authentication

```http
Authorization: Bearer edj_live_<prefix>.<secret>
```

Rotate or disable keys from `/admin/offsite`. Only the hash is stored.

## Endpoints

Base path: `/api/integration/v1`

### Upsert agenda session

`PUT /agenda-sessions/:externalSessionId`

```json
{
  "title": "Opening Reception",
  "roomName": "Main Hall",
  "startsAt": "2026-09-14T18:00:00.000Z",
  "endsAt": "2026-09-14T20:00:00.000Z",
  "revision": "agenda-v42",
  "state": "live",
  "settings": {
    "requestsOpen": true,
    "defaultDurationMs": 60000,
    "forceInstrumental": true,
    "autoApprove": true,
    "autoDj": {
      "enabled": true,
      "target": 2,
      "brief": "warm arrival house for a rooftop sunset reception",
      "autoplay": true
    }
  },
  "metadata": {
    "portalRequestUrl": "https://elevencancun2026.lovable.app/music/request"
  }
}
```

`state: "ended"` closes requests and pauses playback. Content is retained.

### AutoDJ

With `autoDj.enabled`, the room writes its own tracks so it never runs dry —
audience requests always take priority, and AutoDJ only makes up the shortfall
below `target`. Send a `brief` per agenda item; it's the single strongest lever
you have over what a room sounds like. Without one the room falls back to a
house style shaped by its title, room name, and time of day.

Three behaviors matter for unattended rooms:

- **Pre-roll** — upserting a room as `live` starts generating immediately, so
  there's music ready before people walk in. Generation takes ~30–60s, so upsert
  a few minutes ahead of the agenda block rather than at its start.
- **Autoplay** — a room with ready audio and nothing playing starts itself. A
  room an operator deliberately paused is left alone.
- **Wind-down** — top-ups stop within 5 minutes of `endsAt`, so a finishing room
  doesn't generate tracks nobody hears. Send `endsAt` to get this.

### Read session / status

- `GET /agenda-sessions/:externalSessionId`
- `GET /agenda-sessions/:externalSessionId/status` — queue counts, playback revision, players

### Submit a request

`POST /agenda-sessions/:externalSessionId/requests`

Required header: `Idempotency-Key` (opaque string, ≥ 8 chars). Both it and
`externalRequestId` are scoped to the agenda session, so the same employee-scoped
id may be reused across concurrent rooms.

```json
{
  "externalRequestId": "portal-request-123",
  "prompt": "Warm upbeat house music for a rooftop sunset",
  "requesterName": "Alex",
  "requesterAvatarUrl": "https://lh3.googleusercontent.com/a/...",
  "instrumental": true
}
```

`requesterAvatarUrl` is optional and must be `https`. When present it's shown
next to the requester's name on the room screen while their track plays. Send
the signed-in portal user's account photo; a broken or unreachable URL simply
renders as the name alone.

Replays with the same external id / idempotency key return the original request
without enqueueing a second generation job.

### Request status

`GET /agenda-sessions/:externalSessionId/requests/:externalRequestId`

### Playback

`POST /agenda-sessions/:externalSessionId/playback`

Required header: `Idempotency-Key`, scoped to the agenda session.

```json
{ "action": "play", "expectedRevision": 0 }
```

Actions: `play`, `pause`, `skip`, `select` (`trackId`, optional `autoplay`),
`ended` (`trackId`). Stale revisions return `409 stale_playback_revision` with
the current playback state in `details.playback`.

### Players / space assignment

- `GET /agenda-sessions/:externalSessionId/players`
- `PUT /agenda-sessions/:externalSessionId/players`

```json
{ "deviceId": "<uuid>", "assign": true }
```

A client may only assign a device that is unassigned or already serving one of
its own rooms; anything else returns `403 device_unavailable`.
Set `assign: false` to unassign. Automatic schedule-driven assignment is the
Lovable phase-two responsibility; ElevenDJ already supports reassignment without
re-pairing.

## Physical players

1. Open `/player` on the room laptop / Apple TV browser / kiosk.
2. Name the device and show the pairing code.
3. Approve (and optionally assign) in `/admin/offsite`.
4. Tap **Enable audio** once (browser autoplay policy).
5. Reassign the device to another agenda session anytime — the player polls and
   switches without reload.

Player cookie: `__Host-elevendj-player` (Secure, HttpOnly, SameSite=Strict).

The player uses the Cancún 2026 display theme copied from the committed portal
source: its Waldenburg fonts, venue image, grain, palette, gradient recipe,
ElevenLabs mark, QR treatment, fullscreen control, and wake lock. These assets
are bundled with ElevenDJ rather than hotlinked, so the room keeps rendering if
the portal is unavailable.

`metadata.portalRequestUrl` controls the request QR destination. The player adds
`?session=<externalSessionId>` as a room hint; the portal must validate it
against the signed-in attendee's live schedule before accepting a request.

## Local host workflow

`/host` and `/stage` remain the single-room DJ console. Local sessions still
enforce one active room per host. Offsite/integration sessions run concurrently
under `/admin/offsite` and never appear in the host session modal.

## Room DJ operators

`/offsite/control` is the event-floor controller: current track, player health,
play/pause/skip/select, queue approval/removal/reordering, on-demand track
generation, request-line and auto-approve switches, AutoDJ brief, and room
volume. It deliberately excludes users, integration keys, player pairing and
revocation, and session setup.

Admins grant a signed-in ElevenLabs employee access to a specific room from
`/admin/offsite`; operators see only their assigned rooms. For an emergency
no-account path, an admin creates a room-control invitation there. It requires
both a 256-bit secret carried in the URL fragment and a separately shared
8-digit PIN. A successful exchange creates a fresh Strict HttpOnly session
cookie, removes the fragment from the address bar, expires within 8 hours, and
can only control that room. Five failed attempts in 15 minutes lock the
invitation for 30 minutes. Rotating it immediately invalidates every session
derived from the previous invitation.

## Lovable phase-two handoff

When ElevenDJ is verified:

1. Store the integration secret in Lovable server env.
2. A few minutes before schedule start → `PUT` agenda session with
   `state: "live"`, an `autoDj.brief` for that agenda item, and assign the
   space’s paired `deviceId`. The lead time lets pre-roll finish.
3. Employee request form → `POST …/requests` with employee-scoped idempotency
   keys / `externalRequestId`.
4. On session end → `PUT` with `state: "ended"` (and optionally unassign).
