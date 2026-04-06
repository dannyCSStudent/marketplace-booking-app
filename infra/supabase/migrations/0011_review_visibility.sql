alter table public.reviews
add column if not exists is_hidden boolean not null default false,
add column if not exists hidden_at timestamptz;
