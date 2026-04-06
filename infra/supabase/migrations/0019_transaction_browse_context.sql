alter table public.orders
  add column if not exists buyer_browse_context text;

alter table public.bookings
  add column if not exists buyer_browse_context text;
