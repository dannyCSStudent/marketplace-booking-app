create table if not exists public.review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  notes text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_reports_reason_nonempty check (char_length(trim(reason)) > 0),
  constraint review_reports_status_valid check (status in ('open', 'triaged', 'resolved')),
  constraint review_reports_unique_reporter unique (review_id, reporter_id)
);

create index if not exists idx_review_reports_review_id on public.review_reports(review_id);
create index if not exists idx_review_reports_status on public.review_reports(status);

alter table public.review_reports enable row level security;

create policy "review_reports_reporter_create_own"
on public.review_reports
for insert
to authenticated
with check (reporter_id = auth.uid());

create policy "review_reports_reporter_read_own"
on public.review_reports
for select
to authenticated
using (reporter_id = auth.uid());
