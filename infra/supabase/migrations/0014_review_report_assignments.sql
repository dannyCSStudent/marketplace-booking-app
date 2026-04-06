alter table public.review_reports
  add column if not exists assignee_user_id uuid,
  add column if not exists assigned_at timestamptz;
