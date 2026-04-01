alter table if exists public.orders
  add column if not exists seller_response_note text;

alter table if exists public.bookings
  add column if not exists seller_response_note text;
