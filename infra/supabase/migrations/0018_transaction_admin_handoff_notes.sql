alter table public.orders
  add column if not exists admin_handoff_note text;

alter table public.bookings
  add column if not exists admin_handoff_note text;
