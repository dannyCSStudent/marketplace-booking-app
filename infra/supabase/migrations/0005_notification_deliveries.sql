create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  transaction_kind text not null check (transaction_kind in ('order', 'booking')),
  transaction_id uuid not null,
  event_id uuid not null,
  channel text not null check (channel in ('email', 'push')),
  delivery_status text not null default 'queued' check (delivery_status in ('queued', 'sent', 'failed', 'skipped')),
  payload jsonb not null default '{}'::jsonb,
  failure_reason text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notification_deliveries_recipient_created_at
  on public.notification_deliveries(recipient_user_id, created_at desc);

create index if not exists idx_notification_deliveries_status
  on public.notification_deliveries(delivery_status, created_at desc);

alter table public.notification_deliveries enable row level security;

create policy "notification_deliveries_recipient_read"
on public.notification_deliveries
for select
to authenticated
using (recipient_user_id = auth.uid());
