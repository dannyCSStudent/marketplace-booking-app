alter table if exists public.profiles
  add column if not exists email_notifications_enabled boolean not null default true,
  add column if not exists push_notifications_enabled boolean not null default true,
  add column if not exists marketing_notifications_enabled boolean not null default false;
