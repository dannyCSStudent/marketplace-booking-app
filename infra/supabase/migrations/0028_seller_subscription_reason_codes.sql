alter table if exists public.seller_subscription_events
  add column if not exists reason_code text;

create index if not exists seller_subscription_events_reason_code_idx
  on public.seller_subscription_events (reason_code, created_at desc);
