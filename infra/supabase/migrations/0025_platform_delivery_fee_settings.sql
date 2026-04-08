create table if not exists public.platform_delivery_fee_settings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  delivery_fee_cents integer not null default 0,
  shipping_fee_cents integer not null default 0,
  is_active boolean not null default false,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint platform_delivery_fee_settings_delivery_fee_nonnegative check (delivery_fee_cents >= 0),
  constraint platform_delivery_fee_settings_shipping_fee_nonnegative check (shipping_fee_cents >= 0)
);

insert into public.platform_delivery_fee_settings (
  name,
  delivery_fee_cents,
  shipping_fee_cents,
  is_active
)
values ('Default delivery fees', 0, 0, true);
