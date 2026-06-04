# ElevenDJ

ElevenDJ is a single-playlist request-line app for generated music. Guests submit prompts at `/request`, the server validates and queues them, a background worker generates a short instrumental track with ElevenLabs Music, uploads the result to Vercel Blob, stores metadata in Supabase Postgres, and Supabase Realtime Broadcast nudges clients to refetch queue state.

## Stack

- Next.js App Router on Vercel
- ElevenLabs Music Compose API
- Supabase Postgres and Realtime Broadcast
- Vercel Blob for public audio playback
- Vercel Workflow as the primary durable runner
- Vercel Queue trigger with `after()` fallback for local and non-workflow deployments

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project, ideally through the Vercel Marketplace integration, then apply:

   ```bash
   supabase/migrations/0001_elevendj_mvp.sql
   ```

3. Copy `.env.example` to `.env.local` and fill in:

   ```bash
   ELEVENLABS_API_KEY=
   BLOB_READ_WRITE_TOKEN=
   SUPABASE_URL=
   SUPABASE_SERVICE_ROLE_KEY=
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   ADMIN_ACCESS_TOKEN=
   REQUEST_HASH_SECRET=
   ENABLE_VERCEL_WORKFLOW=true
   ENABLE_VERCEL_QUEUE=false
   NEXT_PUBLIC_REALTIME_TOPIC=playlist:main
   ```

4. Run locally:

   ```bash
   npm run dev
   ```

## Routes

- `/request`: public request line.
- `/player`: shared playlist player.
- `/admin`: token-protected queue controls.
- `POST /api/requests`: validates prompt, rate-limits by hashed IP, inserts a queued request, and starts generation.
- `GET /api/queue`: canonical queue snapshot for player and admin UI.
- `GET /api/requests/[id]?token=...`: submitter-only request status.

## Security Defaults

- Browser clients never receive `ELEVENLABS_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BLOB_READ_WRITE_TOKEN`, or `REQUEST_HASH_SECRET`.
- Public submissions only go through server routes.
- RLS is enabled with deny-all public policies; server routes use the Supabase service role.
- Realtime broadcasts carry minimal event payloads, and clients refetch canonical state from APIs.
