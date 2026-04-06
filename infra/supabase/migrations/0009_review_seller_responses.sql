alter table public.reviews
add column if not exists seller_response text,
add column if not exists seller_responded_at timestamptz;

create policy "reviews_seller_update_own"
on public.reviews
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
