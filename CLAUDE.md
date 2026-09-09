# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ElevenDJ is a multi-tenant, real-time AI music-request platform. Each authenticated host runs an independent session (own playlist, settings, public request link). Guests submit prompts via a QR/URL, the server validates and queues them, a durable Vercel Workflow generates an MP3 via the ElevenLabs Music API, uploads it to Vercel Blob, and clients sync playback via Supabase Realtime Broadcast.

## Stack

Next.js 16 (App Router + Turbopack) · React 19 · TypeScript (strict) · Tailwind 4 · Neon Postgres + Drizzle ORM · Neon Auth (OAuth) · ElevenLabs Music API · Vercel Blob / Workflow / Queue · Supabase Realtime Broadcast. Source lives in `src/` (`@/*` → `./src/*`).

## Commands

Package manager is **pnpm** (`pnpm-lock.yaml`).

- `pnpm dev` — local dev (Turbopack)
- `pnpm build` / `pnpm start` — production build / serve
- `pnpm lint` — ESLint (flat config)
- **No test suite** — verify changes manually and lean on TypeScript strict mode.

### Database (Drizzle)

No package.json script — call drizzle-kit directly. This repo applies schema changes with `push` (diffs `src/lib/db/schema.ts` straight to the DB); there are **no tracked migration files**:
- `pnpm drizzle-kit push` — apply the current schema (add `--force` in a non-interactive shell)

`drizzle.config.ts` throws unless a DB URL is set, so load the env first — it reads `NEON_DATABASE_URL_UNPOOLED` (direct connection); runtime queries use the pooled `NEON_DATABASE_URL`. The schema relies on the `pgcrypto` extension (`gen_random_bytes()` in `public_code` default) — ensure it's enabled on the Neon branch.

## Gotchas

- **Registry mirror:** `.npmrc` points the registry at `registry.npmmirror.com` (used by pnpm too) because SentinelOne EDR blocks `registry.npmjs.org` on this machine. Leave it unless IT allowlists the real registry; it's a verified mirror.
- **Neon Auth `sameSite: "lax"`** (in `src/lib/auth/server.ts`) is intentional — strict mode drops the Google OAuth challenge cookie on the cross-site return. Don't "fix" it to strict.
- **Job dispatch is a fallback chain** (`src/lib/enqueue.ts`): Vercel Workflow → Queue → Next.js `after()`. There's no retry between stages; an idempotency key prevents duplicate generations on replay. Toggle via `ENABLE_VERCEL_WORKFLOW` / `ENABLE_VERCEL_QUEUE`.
- **Host ElevenLabs keys** are AES-256-GCM encrypted at rest (`src/lib/crypto.ts`), decrypted in-memory only when calling the API. Requires `ELEVENLABS_KEY_SECRET` (32-byte base64). Falls back to the shared `ELEVENLABS_API_KEY` for admins.
- **One active local session per host** — enforced by a unique partial index on
  `source = 'local'`; old local sessions are soft-deleted (`isActive = false`),
  not removed. Integration-backed Offsite sessions may run concurrently.
- **Offsite / Lovable** — server-to-server Integration API + `/admin/offsite` +
  paired `/player` devices. Contract: `docs/OFFSITE_INTEGRATION.md`.
- **Realtime payloads are minimal** — broadcasts only nudge clients; canonical state is refetched from `/api/queue`.
- **Music v1↔v2 lyrics** — `lyrics` is JSONB; `src/lib/generation.ts` parses both v1 (`sections`) and v2 (`chunks`) plans. Model selected via `MUSIC_MODEL` (default `music_v2`).

## Code style

- TypeScript strict; path alias `@/*`. No Prettier configured — match surrounding style.
- Mark server-only modules with `server-only`; never send secrets (API keys, blob token) to clients.
- `react-hooks/set-state-in-effect` is a warning (intentional fetch-on-mount patterns) — don't treat as an error to refactor away blindly.

## Setup

Copy `.env.example` → `.env.local`. Required: `NEON_DATABASE_URL`, `NEON_DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `ELEVENLABS_API_KEY`, `ELEVENLABS_KEY_SECRET`, `BLOB_READ_WRITE_TOKEN`, `ADMIN_ACCESS_TOKEN`, `REQUEST_HASH_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. See `.env.example` for optional `MUSIC_*` flags and full descriptions.

## Key files

- `src/lib/db/schema.ts` — data model (4 tables) · `src/lib/db/queries.ts` — most DB business logic
- `src/lib/generation.ts` — ElevenLabs Music calls + error parsing
- `src/workflows/generate-song.ts` — durable Workflow entry (keep minimal) · `src/lib/enqueue.ts` — dispatch chain
- `src/app/api/requests/route.ts` — public submission (rate-limit + validation) · `src/app/api/queue/` — canonical playlist state
- `src/lib/security.ts` — prompt validation, IP hashing, auth checks
