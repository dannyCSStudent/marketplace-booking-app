create table if not exists public.seller_subscription_events (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.seller_profiles(id) on delete cascade,
  seller_subscription_id uuid references public.seller_subscriptions(id) on delete set null,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  from_tier_id uuid references public.subscription_tiers(id) on delete set null,
  to_tier_id uuid references public.subscription_tiers(id) on delete set null,
  note text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists seller_subscription_events_seller_idx
  on public.seller_subscription_events (seller_id, created_at desc);

create index if not exists seller_subscription_events_created_idx
  on public.seller_subscription_events (created_at desc);
