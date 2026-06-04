create extension if not exists pgcrypto;

create schema if not exists private;

create table if not exists public.playlist_settings (
  id boolean primary key default true,
  requests_open boolean not null default true,
  max_pending_requests integer not null default 25,
  max_ready_queue integer not null default 50,
  default_duration_ms integer not null default 60000,
  force_instrumental boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playlist_settings_singleton check (id),
  constraint playlist_settings_duration check (default_duration_ms between 3000 and 300000)
);

insert into public.playlist_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.song_requests (
  id uuid primary key default gen_random_uuid(),
  client_token_hash text not null,
  requester_name text,
  prompt text not null,
  normalized_prompt text not null,
  status text not null default 'queued',
  position integer,
  duration_ms integer not null default 60000,
  audio_url text,
  blob_path text,
  song_id text,
  prompt_suggestion text,
  error_code text,
  error_message text,
  ip_hash text,
  idempotency_key text not null,
  generation_attempts integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint song_requests_status check (status in ('queued', 'generating', 'ready', 'rejected', 'failed', 'played')),
  constraint song_requests_duration check (duration_ms between 3000 and 300000),
  constraint song_requests_idempotency_unique unique (idempotency_key)
);

create index if not exists song_requests_status_position_idx
  on public.song_requests (status, position nulls last, created_at);

create index if not exists song_requests_ip_created_idx
  on public.song_requests (ip_hash, created_at desc);

create index if not exists song_requests_normalized_active_idx
  on public.song_requests (normalized_prompt, created_at desc)
  where status in ('queued', 'generating', 'ready');

create table if not exists public.playback_state (
  id boolean primary key default true,
  current_request_id uuid references public.song_requests(id) on delete set null,
  is_playing boolean not null default false,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint playback_state_singleton check (id)
);

insert into public.playback_state (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.request_events (
  id bigint generated always as identity primary key,
  request_id uuid references public.song_requests(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists playlist_settings_set_updated_at on public.playlist_settings;
create trigger playlist_settings_set_updated_at
before update on public.playlist_settings
for each row execute function private.set_updated_at();

drop trigger if exists song_requests_set_updated_at on public.song_requests;
create trigger song_requests_set_updated_at
before update on public.song_requests
for each row execute function private.set_updated_at();

drop trigger if exists playback_state_set_updated_at on public.playback_state;
create trigger playback_state_set_updated_at
before update on public.playback_state
for each row execute function private.set_updated_at();

create or replace function private.broadcast_song_request_change()
returns trigger
security definer
language plpgsql
set search_path = ''
as $$
declare
  event_name text;
  request_id uuid;
  request_status text;
  request_position integer;
begin
  if tg_op = 'DELETE' then
    request_id := old.id;
    request_status := old.status;
    request_position := old.position;
  else
    request_id := new.id;
    request_status := new.status;
    request_position := new.position;
  end if;

  event_name := case
    when tg_op = 'INSERT' then 'request_updated'
    when tg_op = 'UPDATE' and old.status is distinct from new.status then 'request_updated'
    else 'queue_changed'
  end;

  perform realtime.send(
    jsonb_build_object(
      'id', request_id,
      'status', request_status,
      'position', request_position,
      'operation', tg_op
    ),
    event_name,
    'playlist:main',
    false
  );

  return null;
end;
$$;

drop trigger if exists song_requests_broadcast_change on public.song_requests;
create trigger song_requests_broadcast_change
after insert or update or delete on public.song_requests
for each row execute function private.broadcast_song_request_change();

alter table public.playlist_settings enable row level security;
alter table public.song_requests enable row level security;
alter table public.playback_state enable row level security;
alter table public.request_events enable row level security;

drop policy if exists "no direct public playlist writes" on public.playlist_settings;
create policy "no direct public playlist writes"
on public.playlist_settings
for all
using (false)
with check (false);

drop policy if exists "no direct public request access" on public.song_requests;
create policy "no direct public request access"
on public.song_requests
for all
using (false)
with check (false);

drop policy if exists "no direct public playback access" on public.playback_state;
create policy "no direct public playback access"
on public.playback_state
for all
using (false)
with check (false);

drop policy if exists "no direct public event access" on public.request_events;
create policy "no direct public event access"
on public.request_events
for all
using (false)
with check (false);
