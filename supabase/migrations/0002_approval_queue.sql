-- AutoDJ vs approval-queue mode + a `pending` request status.
--
-- auto_dj = true  (default): public requests generate automatically, as before.
-- auto_dj = false (approval): public requests land in `pending` and the host
--   must approve them before generation starts.

alter table public.playlist_settings
  add column if not exists auto_dj boolean not null default true;

-- Allow requests to sit in a `pending` (awaiting host approval) state.
alter table public.song_requests
  drop constraint if exists song_requests_status;

alter table public.song_requests
  add constraint song_requests_status
  check (status in ('pending', 'queued', 'generating', 'ready', 'rejected', 'failed', 'played', 'archived'));
