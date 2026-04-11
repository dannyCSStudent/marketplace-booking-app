create table if not exists public.order_fraud_watch_events (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  buyer_display_name text not null,
  delivery_id uuid references public.notification_deliveries(id) on delete cascade,
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  alert_signature text not null,
  order_exception_count integer not null default 0,
  recent_order_exception_count integer not null default 0,
  risk_level text not null,
  latest_order_id uuid,
  latest_order_status text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists order_fraud_watch_events_buyer_idx
  on public.order_fraud_watch_events (buyer_id, created_at desc);

create index if not exists order_fraud_watch_events_created_idx
  on public.order_fraud_watch_events (created_at desc);

alter table public.order_fraud_watch_events enable row level security;

create policy "order_fraud_watch_events_admin_read"
on public.order_fraud_watch_events
for select
to authenticated
using (true);
