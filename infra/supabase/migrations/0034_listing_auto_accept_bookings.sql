alter table public.listings
  add column if not exists auto_accept_bookings boolean not null default false;
