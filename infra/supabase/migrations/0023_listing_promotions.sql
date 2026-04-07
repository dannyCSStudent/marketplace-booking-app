alter table public.listings
  add column if not exists is_promoted boolean not null default false;
