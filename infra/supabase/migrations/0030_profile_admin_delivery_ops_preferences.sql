alter table profiles
  add column if not exists admin_delivery_ops_preferences jsonb not null default '{}'::jsonb;
