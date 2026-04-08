create table if not exists public.subscription_tiers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_price_cents integer not null default 0 check (monthly_price_cents >= 0),
  perks_summary text,
  analytics_enabled boolean not null default false,
  priority_visibility boolean not null default false,
  premium_storefront boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.seller_subscriptions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.seller_profiles(id) on delete cascade,
  tier_id uuid not null references public.subscription_tiers(id) on delete restrict,
  started_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_subscription_tiers_active
  on public.subscription_tiers(is_active, created_at desc);

create index if not exists idx_seller_subscriptions_seller_active
  on public.seller_subscriptions(seller_id, is_active, started_at desc);

create unique index if not exists idx_seller_subscriptions_one_active
  on public.seller_subscriptions(seller_id)
  where is_active = true;

alter table public.subscription_tiers enable row level security;
alter table public.seller_subscriptions enable row level security;

create policy "subscription_tiers_public_read"
on public.subscription_tiers
for select
using (is_active = true);

create policy "seller_subscriptions_select_own"
on public.seller_subscriptions
for select
using (
  exists (
    select 1
    from public.seller_profiles sp
    where sp.id = seller_id
      and sp.user_id = auth.uid()
  )
);
