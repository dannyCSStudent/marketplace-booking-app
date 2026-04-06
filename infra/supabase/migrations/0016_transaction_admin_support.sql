alter table public.orders
  add column if not exists admin_note text,
  add column if not exists admin_assignee_user_id uuid references auth.users(id) on delete set null,
  add column if not exists admin_assigned_at timestamptz,
  add column if not exists admin_is_escalated boolean not null default false,
  add column if not exists admin_escalated_at timestamptz;

alter table public.bookings
  add column if not exists admin_note text,
  add column if not exists admin_assignee_user_id uuid references auth.users(id) on delete set null,
  add column if not exists admin_assigned_at timestamptz,
  add column if not exists admin_is_escalated boolean not null default false,
  add column if not exists admin_escalated_at timestamptz;
