create table if not exists public.platform_fee_rates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rate numeric(5,4) not null default 0,
  is_active boolean not null default false,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

insert into public.platform_fee_rates (name, rate, is_active)
values ('Default fee', 0.0500, true);

alter table public.orders
  add column if not exists platform_fee_rate numeric(5,4) not null default 0;

alter table public.bookings
  add column if not exists platform_fee_rate numeric(5,4) not null default 0,
  add column if not exists platform_fee_cents integer not null default 0;
