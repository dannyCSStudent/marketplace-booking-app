insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing-media',
  'listing-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "listing_media_public_read" on storage.objects;
create policy "listing_media_public_read"
on storage.objects
for select
to public
using (bucket_id = 'listing-media');

drop policy if exists "listing_media_authenticated_upload" on storage.objects;
create policy "listing_media_authenticated_upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'listing-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "listing_media_authenticated_update" on storage.objects;
create policy "listing_media_authenticated_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'listing-media'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'listing-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "listing_media_authenticated_delete" on storage.objects;
create policy "listing_media_authenticated_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'listing-media'
  and (storage.foldername(name))[1] = auth.uid()::text
);
