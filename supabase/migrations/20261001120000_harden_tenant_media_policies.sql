drop policy if exists tenant_logos_authenticated_update on storage.objects;

create policy tenant_logos_authenticated_update
on storage.objects for update to authenticated
using (
  bucket_id = 'tenant-logos'
  and exists (
    select 1
    from public.profiles profile
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and (
        profile.role = 'platform_admin'
        or profile.barbershop_id::text = (storage.foldername(storage.objects.name))[1]
      )
  )
)
with check (
  bucket_id = 'tenant-logos'
  and lower(storage.extension(name)) in ('svg', 'png', 'jpg', 'jpeg')
  and exists (
    select 1
    from public.profiles profile
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and (
        profile.role = 'platform_admin'
        or profile.barbershop_id::text = (storage.foldername(storage.objects.name))[1]
      )
  )
);

drop policy if exists tenant_site_media_owner_update on storage.objects;
create policy tenant_site_media_owner_update
on storage.objects for update to authenticated
using (
  bucket_id = 'tenant-site-media'
  and exists (
    select 1
    from public.profiles profile
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and profile.role in ('owner', 'platform_admin')
      and (
        profile.role = 'platform_admin'
        or profile.barbershop_id::text = (storage.foldername(storage.objects.name))[1]
      )
  )
)
with check (
  bucket_id = 'tenant-site-media'
  and lower(storage.extension(name)) in ('jpg', 'jpeg')
  and exists (
    select 1
    from public.profiles profile
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and profile.role in ('owner', 'platform_admin')
      and (
        profile.role = 'platform_admin'
        or profile.barbershop_id::text = (storage.foldername(storage.objects.name))[1]
      )
  )
);

drop policy if exists tenant_site_media_owner_delete on storage.objects;
create policy tenant_site_media_owner_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'tenant-site-media'
  and exists (
    select 1
    from public.profiles profile
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and profile.role in ('owner', 'platform_admin')
      and (
        profile.role = 'platform_admin'
        or profile.barbershop_id::text = (storage.foldername(storage.objects.name))[1]
      )
  )
);

comment on policy tenant_logos_authenticated_update on storage.objects is
  'Revalidates bucket, extension, active profile and destination tenant folder on every logo update.';

comment on policy tenant_site_media_owner_update on storage.objects is
  'Owners update JPEG site media only inside their tenant UUID folder; platform admins may update for support.';

comment on policy tenant_site_media_owner_delete on storage.objects is
  'Owners delete site media only inside their tenant UUID folder; platform admins may delete for support.';

