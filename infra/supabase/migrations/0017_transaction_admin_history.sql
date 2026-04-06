create table if not exists public.order_admin_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  note text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists order_admin_events_order_id_idx
  on public.order_admin_events (order_id, created_at desc);

create table if not exists public.booking_admin_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  note text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists booking_admin_events_booking_id_idx
  on public.booking_admin_events (booking_id, created_at desc);
