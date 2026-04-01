create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status order_status not null,
  actor_role text not null check (actor_role in ('buyer', 'seller', 'system')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.booking_status_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  status booking_status not null,
  actor_role text not null check (actor_role in ('buyer', 'seller', 'system')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_status_events_order_id
  on public.order_status_events(order_id, created_at desc);

create index if not exists idx_booking_status_events_booking_id
  on public.booking_status_events(booking_id, created_at desc);

alter table public.order_status_events enable row level security;
alter table public.booking_status_events enable row level security;

create policy "order_status_events_buyer_or_seller_read"
on public.order_status_events
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    left join public.seller_profiles sp on sp.id = o.seller_id
    where o.id = order_id
      and (o.buyer_id = auth.uid() or sp.user_id = auth.uid())
  )
);

create policy "order_status_events_buyer_or_seller_create"
on public.order_status_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.orders o
    left join public.seller_profiles sp on sp.id = o.seller_id
    where o.id = order_id
      and (
        (actor_role = 'buyer' and o.buyer_id = auth.uid())
        or (actor_role = 'seller' and sp.user_id = auth.uid())
      )
  )
);

create policy "booking_status_events_buyer_or_seller_read"
on public.booking_status_events
for select
to authenticated
using (
  exists (
    select 1
    from public.bookings b
    left join public.seller_profiles sp on sp.id = b.seller_id
    where b.id = booking_id
      and (b.buyer_id = auth.uid() or sp.user_id = auth.uid())
  )
);

create policy "booking_status_events_buyer_or_seller_create"
on public.booking_status_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.bookings b
    left join public.seller_profiles sp on sp.id = b.seller_id
    where b.id = booking_id
      and (
        (actor_role = 'buyer' and b.buyer_id = auth.uid())
        or (actor_role = 'seller' and sp.user_id = auth.uid())
      )
  )
);
