create table if not exists public.monetization_watchlist_events (
  id uuid primary key default gen_random_uuid(),
  alert_id text not null,
  alert_signature text not null,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  alert_title text not null,
  alert_severity text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_monetization_watchlist_events_alert_id_created_at
  on public.monetization_watchlist_events (alert_id, created_at desc);

create index if not exists idx_monetization_watchlist_events_created_at
  on public.monetization_watchlist_events (created_at desc);
