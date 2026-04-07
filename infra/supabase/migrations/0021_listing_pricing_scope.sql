alter table public.listings
add column if not exists last_pricing_comparison_scope text;
