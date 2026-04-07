create table if not exists public.promotion_events (
  id uuid not null default gen_random_uuid(),
  listing_id uuid not null,
  seller_id uuid not null,
  promoted boolean not null,
  platform_fee_rate numeric not null,
  created_at timestamptz not null default now(),
  primary key (id)
);

create index if not exists promotion_events_listing_idx on public.promotion_events (listing_id);
create index if not exists promotion_events_seller_idx on public.promotion_events (seller_id);
create index if not exists promotion_events_created_at_idx on public.promotion_events (created_at desc);
