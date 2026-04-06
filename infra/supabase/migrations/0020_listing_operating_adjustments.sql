alter table public.listings
  add column if not exists last_operating_adjustment_at timestamptz,
  add column if not exists last_operating_adjustment_summary text;
