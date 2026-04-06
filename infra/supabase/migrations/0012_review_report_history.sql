alter table public.review_reports
add column if not exists moderator_note text;

create table if not exists public.review_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.review_reports(id) on delete cascade,
  actor_user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_review_report_events_report_id
on public.review_report_events(report_id);

alter table public.review_report_events enable row level security;

create policy "review_report_events_admin_read"
on public.review_report_events
for select
to authenticated
using (true);
