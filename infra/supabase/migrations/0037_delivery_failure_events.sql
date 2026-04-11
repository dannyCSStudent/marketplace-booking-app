create table if not exists public.delivery_failure_events (
  id uuid primary key default gen_random_uuid(),
  failed_delivery_id uuid not null references public.notification_deliveries(id) on delete cascade,
  delivery_id uuid references public.notification_deliveries(id) on delete cascade,
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  alert_signature text not null,
  failed_delivery_channel text not null,
  failed_delivery_status text not null,
  failed_delivery_attempts integer not null default 0,
  failed_delivery_reason text not null,
  original_recipient_user_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists delivery_failure_events_failed_delivery_idx
  on public.delivery_failure_events (failed_delivery_id, created_at desc);

create index if not exists delivery_failure_events_created_idx
  on public.delivery_failure_events (created_at desc);

alter table public.delivery_failure_events enable row level security;

create policy "delivery_failure_events_admin_read"
on public.delivery_failure_events
for select
to authenticated
using (true);
