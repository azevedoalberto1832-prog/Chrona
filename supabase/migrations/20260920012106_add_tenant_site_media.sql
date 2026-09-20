insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tenant-site-media','tenant-site-media',true,5242880,array['image/jpeg']::text[])
on conflict(id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists tenant_site_media_owner_insert on storage.objects;
create policy tenant_site_media_owner_insert
on storage.objects for insert to authenticated
with check (
  bucket_id='tenant-site-media'
  and lower(storage.extension(name)) in ('jpg','jpeg')
  and exists (
    select 1
    from public.profiles profile
    where profile.auth_user_id=(select auth.uid())
      and profile.active
      and profile.role in ('owner','platform_admin')
      and (
        profile.role='platform_admin'
        or profile.barbershop_id::text=(storage.foldername(storage.objects.name))[1]
      )
  )
);

comment on policy tenant_site_media_owner_insert on storage.objects is
  'Owners upload JPEG site media only inside their tenant UUID folder; platform admins may upload for support.';
