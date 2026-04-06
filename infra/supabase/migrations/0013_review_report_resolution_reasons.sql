alter table public.review_reports
  add column if not exists resolution_reason text;
