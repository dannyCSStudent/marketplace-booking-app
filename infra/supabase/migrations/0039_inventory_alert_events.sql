create table if not exists public.inventory_alert_events (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.seller_profiles(id) on delete cascade,
  seller_slug text not null,
  seller_display_name text not null,
  delivery_id uuid references public.notification_deliveries(id) on delete cascade,
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  alert_signature text not null,
  listing_id uuid not null,
  listing_title text not null,
  inventory_bucket text not null,
  inventory_count integer,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists inventory_alert_events_seller_idx
  on public.inventory_alert_events (seller_id, created_at desc);

create index if not exists inventory_alert_events_listing_idx
  on public.inventory_alert_events (listing_id, created_at desc);

create index if not exists inventory_alert_events_created_idx
  on public.inventory_alert_events (created_at desc);

alter table public.inventory_alert_events enable row level security;

create policy "inventory_alert_events_admin_read"
on public.inventory_alert_events
for select
to authenticated
using (true);
