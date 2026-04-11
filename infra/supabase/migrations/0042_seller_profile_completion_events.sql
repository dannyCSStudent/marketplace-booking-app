create table if not exists public.seller_profile_completion_events (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.seller_profiles(id) on delete cascade,
  seller_slug text not null,
  seller_display_name text not null,
  delivery_id uuid references public.notification_deliveries(id) on delete cascade,
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  alert_signature text not null,
  completion_percent integer not null,
  missing_fields text[] not null default '{}'::text[],
  summary text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists seller_profile_completion_events_seller_idx
  on public.seller_profile_completion_events (seller_id, created_at desc);

create index if not exists seller_profile_completion_events_created_idx
  on public.seller_profile_completion_events (created_at desc);

alter table public.seller_profile_completion_events enable row level security;

create policy "seller_profile_completion_events_admin_read"
on public.seller_profile_completion_events
for select
to authenticated
using (true);
