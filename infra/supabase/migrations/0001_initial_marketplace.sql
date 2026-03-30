create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_role') then
    create type account_role as enum ('buyer', 'seller', 'both', 'admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'listing_type') then
    create type listing_type as enum ('product', 'service', 'hybrid');
  end if;

  if not exists (select 1 from pg_type where typname = 'listing_status') then
    create type listing_status as enum ('draft', 'active', 'paused', 'sold_out', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'fulfillment_method') then
    create type fulfillment_method as enum ('pickup', 'meetup', 'delivery', 'shipping');
  end if;

  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum (
      'pending',
      'confirmed',
      'preparing',
      'ready',
      'out_for_delivery',
      'completed',
      'canceled',
      'refunded'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'booking_status') then
    create type booking_status as enum (
      'requested',
      'confirmed',
      'declined',
      'in_progress',
      'completed',
      'canceled',
      'no_show'
    );
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  full_name text,
  phone text,
  avatar_url text,
  role account_role not null default 'buyer',
  city text,
  state text,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.seller_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  display_name text not null,
  slug text not null unique,
  bio text,
  is_verified boolean not null default false,
  accepts_custom_orders boolean not null default true,
  average_rating numeric(3,2) not null default 0,
  review_count integer not null default 0,
  city text,
  state text,
  country text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  parent_id uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.seller_profiles(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  title text not null,
  slug text not null unique,
  description text,
  type listing_type not null,
  status listing_status not null default 'draft',
  price_cents integer,
  currency text not null default 'USD',
  inventory_count integer,
  requires_booking boolean not null default false,
  duration_minutes integer,
  is_local_only boolean not null default true,
  city text,
  state text,
  country text,
  pickup_enabled boolean not null default false,
  meetup_enabled boolean not null default false,
  delivery_enabled boolean not null default false,
  shipping_enabled boolean not null default false,
  lead_time_hours integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listings_price_nonnegative check (price_cents is null or price_cents >= 0),
  constraint listings_inventory_nonnegative check (inventory_count is null or inventory_count >= 0),
  constraint listings_duration_positive check (duration_minutes is null or duration_minutes > 0)
);

create table if not exists public.listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  image_url text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.listing_availability (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  weekday integer not null,
  start_time time not null,
  end_time time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint listing_availability_weekday_valid check (weekday between 0 and 6),
  constraint listing_availability_time_valid check (end_time > start_time)
);

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text,
  recipient_name text,
  phone text,
  line1 text not null,
  line2 text,
  city text not null,
  state text,
  postal_code text,
  country text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.seller_profiles(id) on delete restrict,
  status order_status not null default 'pending',
  fulfillment fulfillment_method not null,
  subtotal_cents integer not null default 0,
  delivery_fee_cents integer not null default 0,
  platform_fee_cents integer not null default 0,
  total_cents integer not null default 0,
  currency text not null default 'USD',
  notes text,
  delivery_address_id uuid references public.addresses(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_amounts_nonnegative check (
    subtotal_cents >= 0 and delivery_fee_cents >= 0 and platform_fee_cents >= 0 and total_cents >= 0
  )
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete restrict,
  quantity integer not null default 1,
  unit_price_cents integer not null,
  total_price_cents integer not null,
  created_at timestamptz not null default now(),
  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_prices_nonnegative check (unit_price_cents >= 0 and total_price_cents >= 0)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.seller_profiles(id) on delete restrict,
  listing_id uuid not null references public.listings(id) on delete restrict,
  status booking_status not null default 'requested',
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  total_cents integer,
  currency text not null default 'USD',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_time_valid check (scheduled_end > scheduled_start),
  constraint bookings_total_nonnegative check (total_cents is null or total_cents >= 0)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  seller_id uuid not null references public.seller_profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  rating integer not null,
  comment text,
  created_at timestamptz not null default now(),
  constraint reviews_rating_valid check (rating between 1 and 5)
);

create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create index if not exists idx_seller_profiles_user_id on public.seller_profiles(user_id);
create index if not exists idx_listings_seller_id on public.listings(seller_id);
create index if not exists idx_listings_category_id on public.listings(category_id);
create index if not exists idx_listings_status on public.listings(status);
create index if not exists idx_orders_buyer_id on public.orders(buyer_id);
create index if not exists idx_orders_seller_id on public.orders(seller_id);
create index if not exists idx_bookings_buyer_id on public.bookings(buyer_id);
create index if not exists idx_bookings_seller_id on public.bookings(seller_id);
create index if not exists idx_reviews_seller_id on public.reviews(seller_id);
create index if not exists idx_addresses_user_id on public.addresses(user_id);

alter table public.profiles enable row level security;
alter table public.seller_profiles enable row level security;
alter table public.categories enable row level security;
alter table public.listings enable row level security;
alter table public.listing_images enable row level security;
alter table public.listing_availability enable row level security;
alter table public.addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.bookings enable row level security;
alter table public.reviews enable row level security;
alter table public.favorites enable row level security;

create policy "profiles_select_own_or_public_minimal"
on public.profiles
for select
to authenticated
using (true);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "seller_profiles_public_read"
on public.seller_profiles
for select
to authenticated
using (true);

create policy "seller_profiles_insert_own"
on public.seller_profiles
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid() and p.id = user_id
  )
);

create policy "seller_profiles_update_own"
on public.seller_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "categories_public_read"
on public.categories
for select
to authenticated
using (true);

create policy "listings_public_read_active_or_owner"
on public.listings
for select
to authenticated
using (
  status = 'active'
  or exists (
    select 1
    from public.seller_profiles sp
    where sp.id = seller_id and sp.user_id = auth.uid()
  )
);

create policy "listings_insert_own"
on public.listings
for insert
to authenticated
with check (
  exists (
    select 1
    from public.seller_profiles sp
    where sp.id = seller_id and sp.user_id = auth.uid()
  )
);

create policy "listings_update_own"
on public.listings
for update
to authenticated
using (
  exists (
    select 1
    from public.seller_profiles sp
    where sp.id = seller_id and sp.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.seller_profiles sp
    where sp.id = seller_id and sp.user_id = auth.uid()
  )
);

create policy "listing_images_public_read"
on public.listing_images
for select
to authenticated
using (
  exists (
    select 1 from public.listings l
    where l.id = listing_id
      and (
        l.status = 'active'
        or exists (
          select 1
          from public.seller_profiles sp
          where sp.id = l.seller_id and sp.user_id = auth.uid()
        )
      )
  )
);

create policy "listing_images_manage_own"
on public.listing_images
for all
to authenticated
using (
  exists (
    select 1
    from public.listings l
    join public.seller_profiles sp on sp.id = l.seller_id
    where l.id = listing_id and sp.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.listings l
    join public.seller_profiles sp on sp.id = l.seller_id
    where l.id = listing_id and sp.user_id = auth.uid()
  )
);

create policy "listing_availability_public_read"
on public.listing_availability
for select
to authenticated
using (
  exists (
    select 1 from public.listings l
    where l.id = listing_id
      and (
        l.status = 'active'
        or exists (
          select 1
          from public.seller_profiles sp
          where sp.id = l.seller_id and sp.user_id = auth.uid()
        )
      )
  )
);

create policy "listing_availability_manage_own"
on public.listing_availability
for all
to authenticated
using (
  exists (
    select 1
    from public.listings l
    join public.seller_profiles sp on sp.id = l.seller_id
    where l.id = listing_id and sp.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.listings l
    join public.seller_profiles sp on sp.id = l.seller_id
    where l.id = listing_id and sp.user_id = auth.uid()
  )
);

create policy "addresses_own_only"
on public.addresses
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "orders_buyer_or_seller_read"
on public.orders
for select
to authenticated
using (
  buyer_id = auth.uid()
  or exists (
    select 1
    from public.seller_profiles sp
    where sp.id = seller_id and sp.user_id = auth.uid()
  )
);

create policy "orders_buyer_create"
on public.orders
for insert
to authenticated
with check (buyer_id = auth.uid());

create policy "orders_buyer_or_seller_update"
on public.orders
for update
to authenticated
using (
  buyer_id = auth.uid()
  or exists (
    select 1
    from public.seller_profiles sp
    where sp.id = seller_id and sp.user_id = auth.uid()
  )
)
with check (
  buyer_id = auth.uid()
  or exists (
    select 1
    from public.seller_profiles sp
    where sp.id = seller_id and sp.user_id = auth.uid()
  )
);

create policy "order_items_buyer_or_seller_read"
on public.order_items
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

create policy "order_items_buyer_create_via_order"
on public.order_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.orders o
    where o.id = order_id and o.buyer_id = auth.uid()
  )
);

create policy "bookings_buyer_or_seller_read"
on public.bookings
for select
to authenticated
using (
  buyer_id = auth.uid()
  or exists (
    select 1
    from public.seller_profiles sp
    where sp.id = seller_id and sp.user_id = auth.uid()
  )
);

create policy "bookings_buyer_create"
on public.bookings
for insert
to authenticated
with check (buyer_id = auth.uid());

create policy "bookings_buyer_or_seller_update"
on public.bookings
for update
to authenticated
using (
  buyer_id = auth.uid()
  or exists (
    select 1
    from public.seller_profiles sp
    where sp.id = seller_id and sp.user_id = auth.uid()
  )
)
with check (
  buyer_id = auth.uid()
  or exists (
    select 1
    from public.seller_profiles sp
    where sp.id = seller_id and sp.user_id = auth.uid()
  )
);

create policy "reviews_public_read"
on public.reviews
for select
to authenticated
using (true);

create policy "reviews_reviewer_create_own"
on public.reviews
for insert
to authenticated
with check (reviewer_id = auth.uid());

create policy "favorites_own_only"
on public.favorites
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());