# Offsite portal → ElevenDJ integration spec

Build brief for the **Offsite2026-tracker** portal (Lovable). ElevenDJ is already
built and deployed; everything below is work on the portal side.

The API reference is `docs/OFFSITE_INTEGRATION.md` — this document is the
"what to build and when to call it" companion.

Production base URL: `https://eleven-dj.vercel.app`

## The shape of it

Employees never see ElevenDJ. They request music inside the portal, signed in as
themselves. The portal's **server** calls ElevenDJ, which generates the track and
plays it on the room's paired player — a laptop or Apple TV wired to that room's
speakers, paired once by an ElevenDJ admin.

```
employee (portal UI)
      │  request form
      ▼
portal server ──Bearer key──► ElevenDJ Integration API
                                    │ generates track, queues it
                                    ▼
                          paired player in that room  ──► speakers
```

So the portal owns: the request form, employee identity, which agenda item is
live in which space, and the schedule that drives room lifecycle. ElevenDJ owns:
generation, the queue, playback, the player devices, and AutoDJ.

## Non-negotiables

- **The integration key is server-only.** There is no CORS grant; browser calls
  will fail, and a leaked key lets anyone queue music in any room. Store it in
  the portal's server environment and call ElevenDJ from server routes only.
- **Never let employees supply `externalSessionId` or another employee's name.**
  Derive both server-side from the signed-in session and the schedule.
- **The portal is the source of truth for the schedule.** ElevenDJ does not know
  when an agenda item starts or ends unless the portal tells it.

## Environment

```
ELEVENDJ_BASE_URL=https://eleven-dj.vercel.app
ELEVENDJ_INTEGRATION_KEY=edj_live_<prefix>.<secret>
```

The key is created in ElevenDJ at `/admin/offsite` → **Integration API keys** and
is shown exactly once. If it's lost, rotate it there. Every request sends:

```http
Authorization: Bearer edj_live_<prefix>.<secret>
```

## Identifier mapping

| Portal concept | ElevenDJ field | Notes |
| --- | --- | --- |
| Agenda item in a space | `externalSessionId` (path) | Stable, unique, opaque. Reuse the agenda item's own id. One ElevenDJ room per agenda item per space. |
| Space / venue | `roomName` | Display only — "Main Hall", "Rooftop". |
| Agenda item title | `title` | Shown in the console and used to shape AutoDJ. |
| Employee request | `externalRequestId` | Unique within the agenda item. Employee id + timestamp works. |
| Employee display name | `requesterName` | Max 40 chars. Shown on the room screen, so use a friendly name. |
| Employee account photo | `requesterAvatarUrl` | Optional, `https`. Shown next to the name on the room screen. |

`externalSessionId` is the join key for everything. Pick it once and keep it
stable — changing it creates a second room.

## Call sequence

### 1. Agenda item goes live

`PUT /api/integration/v1/agenda-sessions/{externalSessionId}`

Call this **a few minutes before** the block starts, not at its start: AutoDJ
pre-rolls tracks on this call and generation takes roughly 30–60 seconds per
track, so the lead time is what makes the room warm when people walk in.

```json
{
  "title": "Opening Reception",
  "roomName": "Main Hall",
  "startsAt": "2026-11-12T23:00:00.000Z",
  "endsAt": "2026-11-13T01:00:00.000Z",
  "revision": "agenda-v42",
  "state": "live",
  "settings": {
    "requestsOpen": true,
    "autoApprove": true,
    "forceInstrumental": true,
    "autoDj": {
      "enabled": true,
      "target": 2,
      "brief": "warm arrival house for a rooftop sunset reception, relaxed and welcoming",
      "autoplay": true
    }
  }
}
```

This endpoint is an upsert and is safe to call repeatedly — use it for schedule
edits too. Send `endsAt`; it's what lets AutoDJ wind down instead of generating
tracks past the end of the block.

**`autoDj.brief` is the single biggest lever on how a room sounds.** Give each
agenda item its own. A closing party and a morning keynote break should not read
the same. Without a brief the room falls back to a house style shaped by the
title, room name, and time of day.

`settings.autoApprove: true` means employee requests generate immediately. Set it
`false` only if someone will be watching `/admin/offsite` to approve each one.

### 2. Employee submits a request

`POST /api/integration/v1/agenda-sessions/{externalSessionId}/requests`

```http
Idempotency-Key: <opaque, ≥ 8 chars>
Content-Type: application/json
```

```json
{
  "externalRequestId": "emp-8842-1763077200",
  "prompt": "Warm upbeat house music for a rooftop sunset",
  "requesterName": "Alex",
  "requesterAvatarUrl": "https://lh3.googleusercontent.com/a/...",
  "instrumental": true
}
```

Send `requesterName` and `requesterAvatarUrl` from the **signed-in session**,
never from form input — that's the whole benefit of requests coming through the
portal. When their track plays, the room screen shows their photo and name, so
the room can see who picked it. Employees who joined with an account that has no
photo just show as a name; a URL that fails to load degrades the same way.

Both `Idempotency-Key` and `externalRequestId` are scoped to the agenda item, so
an employee-scoped key is fine even when several rooms run at once. A replay
returns `200` with `"replayed": true` and the original request; a new request
returns `201`.

Constraints worth validating in the portal UI before the call, so employees get
an inline error instead of a failed request:

| Field | Rule |
| --- | --- |
| `prompt` | 10–800 characters |
| `requesterName` | 1–40 characters |
| `requesterAvatarUrl` | optional, `https` only, max 500 characters |
| `externalRequestId` | 1–120 characters |
| `Idempotency-Key` | at least 8 characters |

### 3. Show the employee what happened (optional)

`GET /api/integration/v1/agenda-sessions/{externalSessionId}/requests/{externalRequestId}`

Returns `status`, `queuePosition`, `title`, and `errorMessage`. Poll it for a few
minutes after submitting if you want "generating → queued → now playing" feedback
in the portal. Status moves `queued → generating → ready → played`.

`GET …/status` returns the whole room instead: queue counts, playback state, and
assigned players. That's the call to use for a "now playing in Main Hall" strip.

### 4. Agenda item ends

`PUT /api/integration/v1/agenda-sessions/{externalSessionId}` with
`{"state": "ended"}`.

Closes the request line, pauses playback, and stops AutoDJ. Content is retained,
so the room can be inspected afterward. Send this even if the schedule already
passed `endsAt` — ElevenDJ won't end a room on its own.

### 5. Player assignment (optional, phase two)

`PUT …/players` with `{"deviceId": "<uuid>", "assign": true}` moves a paired
device into this room. Get device ids from `GET …/players` or from
`/admin/offsite`.

Only needed if you want the schedule to move players between spaces
automatically. For a first pass, assign each room's player once by hand in
`/admin/offsite` — a device stays put until someone moves it, and reassignment
never requires re-pairing.

## Error handling

Every error returns `{"error": "<code>", "message": "<human text>"}`. Branch on
`error`, never on the message text.

| Status | `error` | What happened | Suggested portal behavior |
| --- | --- | --- | --- |
| 401 | `unauthorized` | Bad or disabled key | Alert the team; don't show employees |
| 404 | `session_not_found` | No room for that `externalSessionId` | Upsert the room, then retry once |
| 403 | `session_ended` | Agenda item is over | Hide the request form |
| 403 | `requests_closed` | Request line paused by an operator | "Requests are paused right now" |
| 403 | `host_key_missing` | Owner host has no usable ElevenLabs key | Alert the team — nothing will generate |
| 409 | `queue_full` | 25 active requests in the room | "The queue is full — try again after the next track" |
| 422 | `prompt_not_allowed` | Named a real artist/song, or unsafe theme | Show `message` inline; the API also returns a hint |
| 400 | `missing_idempotency_key` | Header absent or under 8 chars | Portal bug |
| 400 | `invalid_body` | Failed validation | Portal bug — validate before sending |

`prompt_not_allowed` is the one employees will actually hit, because people
naturally type "something like Daft Punk." Show that message inline in the form
and nudge them toward mood, tempo, instruments, and setting.

## Rate limiting and abuse

Integration requests bypass ElevenDJ's per-IP guest rate limit — the portal is
trusted, so its calls all look like one client. That means **the portal owns
per-employee throttling.** Without it, one person can flood a room.

Suggested: one request per employee per 10 minutes per room, enforced server-side
against the signed-in identity. The room also caps at 25 active requests, which
protects the room but not fairness between employees.

## Suggested portal UX

- Show the request form only for the space the employee is currently in, and only
  while that agenda item is live.
- Prefill nothing, but show two or three example prompts — people write much
  better prompts with an example in front of them.
- After submitting, show their track's queue position and status. The wait is
  30–60 seconds and visible progress makes it feel intentional.
- Consider a "now playing in this room" line using `GET …/status`. Cheap, and it
  closes the loop between requesting and hearing.

## Testing plan

1. Ask ElevenDJ for a **separate integration key for staging** so portal testing
   never touches live offsite rooms.
2. Use a throwaway `externalSessionId` like `staging-smoke-1`.
3. Walk the full lifecycle: upsert live → submit a request → poll status until
   `ready` → `PUT` state `ended`.
4. Watch it land in `/admin/offsite` — the room, the queue, and playback all
   appear there in real time.

Every track generated during testing costs ElevenLabs credits on the owner host's
account, so keep `autoDj.enabled: false` for staging rooms unless you're
specifically testing AutoDJ.

## Open questions for the portal team

1. Does the portal already model "which space is an employee in right now," or
   does the request form need a space picker?
2. Where should the AutoDJ brief per agenda item be authored — hardcoded per
   item, or an editable field for the events team?
3. Requests are attributed publicly on the room screen — name plus account photo
   when one is available. Is that what you want for every space, or should some
   rooms stay anonymous?
4. Who gets alerted on `host_key_missing` or `unauthorized` during the event?
