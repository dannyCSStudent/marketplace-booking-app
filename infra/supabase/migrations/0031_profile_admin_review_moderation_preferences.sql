alter table public.profiles
  add column if not exists admin_review_moderation_preferences jsonb not null default '{}'::jsonb;

update public.profiles
set admin_review_moderation_preferences = '{}'::jsonb
where admin_review_moderation_preferences is null;

alter table public.profiles
  alter column admin_review_moderation_preferences set default '{}'::jsonb;
