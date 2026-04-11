alter table public.profiles
  add column if not exists admin_transaction_support_preferences jsonb not null default '{}'::jsonb;

update public.profiles
set admin_transaction_support_preferences = '{}'::jsonb
where admin_transaction_support_preferences is null;

alter table public.profiles
  alter column admin_transaction_support_preferences set default '{}'::jsonb;
