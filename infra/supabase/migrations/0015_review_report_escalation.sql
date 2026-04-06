alter table public.review_reports
  add column if not exists is_escalated boolean not null default false,
  add column if not exists escalated_at timestamptz;
