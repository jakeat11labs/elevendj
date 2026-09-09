# Offsite Integration API

ElevenDJ exposes a server-to-server Integration API so the Lovable Offsite portal
can manage agenda-session music rooms, submit song requests, assign physical
players, and issue playback commands.

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
    "autoDj": true
  },
  "metadata": {}
}
```

`state: "ended"` closes requests and pauses playback. Content is retained.

### Read session / status

- `GET /agenda-sessions/:externalSessionId`
- `GET /agenda-sessions/:externalSessionId/status` — queue counts, playback revision, players

### Submit a request

`POST /agenda-sessions/:externalSessionId/requests`

Required header: `Idempotency-Key` (opaque string, ≥ 8 chars).

```json
{
  "externalRequestId": "portal-request-123",
  "prompt": "Warm upbeat house music for a rooftop sunset",
  "requesterName": "Alex",
  "instrumental": true
}
```

Replays with the same external id / idempotency key return the original request
without enqueueing a second generation job.

### Request status

`GET /agenda-sessions/:externalSessionId/requests/:externalRequestId`

### Playback

`POST /agenda-sessions/:externalSessionId/playback`

Required header: `Idempotency-Key`.

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

## Local host workflow

`/host` and `/stage` remain the single-room DJ console. Local sessions still
enforce one active room per host. Offsite/integration sessions run concurrently
under `/admin/offsite` and never appear in the host session modal.

## Lovable phase-two handoff

When ElevenDJ is verified:

1. Store the integration secret in Lovable server env.
2. On schedule start → `PUT` agenda session with `state: "live"` and assign the
   space’s paired `deviceId`.
3. Employee request form → `POST …/requests` with employee-scoped idempotency
   keys / `externalRequestId`.
4. On session end → `PUT` with `state: "ended"` (and optionally unassign).
