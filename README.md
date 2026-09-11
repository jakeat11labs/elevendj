# ElevenDJ

ElevenDJ is a multi-tenant live music request line for AI-generated tracks. Each
host signs in with their ElevenLabs Google account, runs an independent room
(session) with its own queue and an unguessable public request link, and connects
their own ElevenLabs key. Guests open `/request?code=<session>` and describe a
track in plain words; the server validates and queues it, a background worker
generates a short song with ElevenLabs Music, uploads the MP3 to Vercel Blob, and
stores metadata in Neon Postgres. Clients poll the queue APIs to stay in sync, and
a fullscreen `/stage` plays the floor with a reactive orb and word-synced lyrics.

## Stack

- Next.js App Router (React 19) on Vercel
- ElevenLabs Music (`music_v2` by default) via `@elevenlabs/elevenlabs-js`
- Neon Postgres with Drizzle ORM (`@neondatabase/serverless`)
- Neon Auth (`@neondatabase/auth`) for ElevenLabs Google sign-in
- Vercel Blob for public audio playback
- Vercel Workflow as the primary durable generation runner, with a Vercel Queue
  trigger and an `after()` fallback for local / non-workflow deployments
- Live updates via client-side interval polling (~2.5–6s); same-origin host↔stage
  mirroring over the browser BroadcastChannel API

## Setup

1. Install dependencies (the repo uses pnpm):

   ```bash
   pnpm install
   ```

2. Provision a Neon Postgres database (e.g. via the Vercel Neon integration), set
   the `NEON_*` env vars (see below), then push the Drizzle schema:

   ```bash
   pnpm drizzle-kit push
   ```

   The schema lives in `src/lib/db/schema.ts`; generated migrations go to
   `./drizzle`.

3. Copy `.env.example` to `.env.local` and fill it in (see Environment):

   ```bash
   cp .env.example .env.local
   ```

4. Run locally:

   ```bash
   pnpm dev
   ```

## Environment

**Required**

- `NEON_DATABASE_URL` — Neon Postgres connection string (pooled; used at runtime).
- `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` — Neon Auth (cookie secret must
  be ≥ 32 characters).
- `ELEVENLABS_KEY_SECRET` — 32-byte base64 master key used to encrypt per-host
  ElevenLabs keys at rest. Generate with `openssl rand -base64 32`.
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob read/write token.

**Conditionally required**

- `ELEVENLABS_API_KEY` — shared ElevenLabs key; used as the fallback for
  admin-hosted sessions that haven't connected their own key.
- `NEON_DATABASE_URL_UNPOOLED` — unpooled connection used by `drizzle-kit` for
  migrations (falls back to `NEON_DATABASE_URL`).

**Optional**

- `ADMIN_EMAILS` — comma-separated emails granted super-admin on first sign-in
  (bootstrap; the DB `isAdmin` flag is the source of truth thereafter).
- `REQUEST_HASH_SECRET` — salt for hashed-IP rate limiting (falls back to
  `NEON_AUTH_COOKIE_SECRET`).
- `MUSIC_MODEL` — `music_v1` pins the legacy model; anything else uses `music_v2`.
- `MUSIC_OUTPUT_FORMAT` — mp3 `codec_samplerate_bitrate` (unknown values ignored).
- `MUSIC_SIGN_C2PA` — `true` to C2PA-sign generated MP3s.
- `MUSIC_STORE_FOR_INPAINTING` — `true` to retain songs server-side (enterprise-gated).
- `MUSIC_AUTO_DURATION` — `false` to use the request's duration instead of auto length.
- `ENABLE_VERCEL_WORKFLOW` (default on), `ENABLE_VERCEL_QUEUE` (default off) —
  generation runner gates.
- `NEXT_PUBLIC_SITE_URL` — absolute site URL for metadata/OG (defaults to the
  Vercel URL).

## Routes

**Pages**

- `/` — landing splash.
- `/sign-in` — ElevenLabs Google sign-in.
- `/request?code=<session>` — public request line for a host's session.
- `/host` — host console (DJ booth: queue, playback, settings, API key).
- `/stage` — fullscreen stage (audio + big screen, reactive orb, word-synced lyrics).
- `/player` — paired physical-space player for Offsite rooms (pairing + remote sync).
- `/offsite/control` — simplified Room DJ console for signed-in Offsite
  operators or a room-scoped emergency link.
- `/admin` — super-admin console (users, sessions, blob storage); auth- and
  admin-gated.
- `/admin/offsite` — Offsite operations (agenda rooms, player pairing, integration keys).

**Selected API routes** (under `src/app/api`)

- `POST /api/requests` — resolves the session `code`, validates and screens the
  prompt, rate-limits by hashed IP, inserts a request (queued, or pending in
  approval mode), and starts generation. Ended sessions are rejected.
- `GET /api/queue` — canonical queue snapshot for the host/stage UIs.
- `GET /api/requests/[id]?token=...` — submitter-only request status.
- `GET /api/now-playing` — current track for the stage.
- `POST /api/jobs/generate` — the generation worker (Vercel Queue trigger / manual).
- `/api/auth/[...path]` — Neon Auth handler.
- `/api/admin/*` — admin surface (users, sessions, settings, playback, queue
  reorder, blob storage + cleanup, per-host API key, Offsite console, …).
- `/api/integration/v1/*` — server-to-server Offsite Integration API (see
  [`docs/OFFSITE_INTEGRATION.md`](docs/OFFSITE_INTEGRATION.md)).
- `GET /api/music/styles` — public allowlisted request-style catalog shared by
  native and portal forms.
- `/api/player/*` — paired player pairing, state, heartbeat, and playback.

## Security

- Server-only secrets never reach the browser: `ELEVENLABS_API_KEY`,
  `ELEVENLABS_KEY_SECRET`, `BLOB_READ_WRITE_TOKEN`, `NEON_DATABASE_URL`,
  `NEON_AUTH_COOKIE_SECRET`, `REQUEST_HASH_SECRET`.
- Hosting is restricted in code to `@elevenlabs.io` Google accounts (Neon Auth);
  admin is gated by the DB `isAdmin` flag (bootstrapped via `ADMIN_EMAILS`).
- Signed-in Room DJ access uses explicit per-room operator grants. Emergency
  access requires both a high-entropy URL-fragment secret (never in request
  logs) and a separate 8-digit PIN, then exchanges them for a revocable Strict
  HttpOnly session cookie scoped to one room.
  Access control is enforced in server routes/guards — there is no Postgres RLS.
- Each host connects their own ElevenLabs key; it is encrypted at rest with
  AES-256-GCM (`ELEVENLABS_KEY_SECRET`) and stored as ciphertext. Only a masked
  `••••last4` hint is returned to the browser, and the key is decrypted
  server-side per generation.
- Public submissions go only through server routes; prompts are validated and
  screened (length + protected-artist/lyric guard), and submissions are
  rate-limited by hashed IP.
- Clients stay in sync by polling the queue APIs for canonical state — there is
  no client-trusted realtime payload.
