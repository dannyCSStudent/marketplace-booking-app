alter table if exists public.notification_deliveries
  drop constraint if exists notification_deliveries_delivery_status_check;

alter table if exists public.notification_deliveries
  add column if not exists attempts integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_attempt_at timestamptz not null default now();

alter table if exists public.notification_deliveries
  add constraint notification_deliveries_delivery_status_check
  check (delivery_status in ('queued', 'processing', 'sent', 'failed', 'skipped'));

create index if not exists idx_notification_deliveries_queue
  on public.notification_deliveries(delivery_status, next_attempt_at, created_at);
