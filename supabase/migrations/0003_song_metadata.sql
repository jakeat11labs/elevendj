-- Song metadata from ElevenLabs `composeDetailed`: a generated title and an
-- explicit-content flag are promoted to columns for display/moderation, while
-- genres/languages/description ride along in the existing `metadata` jsonb.
alter table public.song_requests
  add column if not exists title text;

alter table public.song_requests
  add column if not exists is_explicit boolean not null default false;

-- Reconcile drift: `lyrics` has been written and selected by the app since the
-- MVP but was never added in a tracked migration. `if not exists` is a no-op
-- where the column already exists on the live database.
alter table public.song_requests
  add column if not exists lyrics jsonb;
