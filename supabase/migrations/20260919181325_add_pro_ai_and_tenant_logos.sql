-- Functional foundation for Pro features and tenant brand assets.
create or replace function private.has_pro_access(target uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists (
    select 1 from public.profiles profile
    where profile.auth_user_id=(select auth.uid()) and profile.active
      and (
        profile.role='platform_admin'
        or (
          profile.barbershop_id=target
          and exists (
            select 1 from public.subscriptions subscription
            where subscription.barbershop_id=target
              and subscription.plan='pro'
              and subscription.status in ('trial','active')
              and (subscription.current_period_end is null or subscription.current_period_end>now())
          )
        )
      )
  );
$$;

revoke all on function private.has_pro_access(uuid) from public,anon;
grant execute on function private.has_pro_access(uuid) to authenticated;

create table if not exists public.tenant_ai_settings (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  assistant_name text not null default 'Assistente',
  tone text not null default 'professional_warm' check (tone in ('professional_warm','direct','friendly','formal')),
  welcome_message text not null default 'Olá! Como posso ajudar com seu agendamento?',
  human_handoff_phone text,
  business_hours_only boolean not null default true,
  can_quote_services boolean not null default true,
  can_check_availability boolean not null default true,
  can_create_appointments boolean not null default false,
  can_reschedule boolean not null default false,
  can_cancel boolean not null default false,
  crm_enabled boolean not null default true,
  status text not null default 'draft' check (status in ('draft','ready','active','paused','error')),
  model text,
  last_error text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.tenant_ai_settings enable row level security;
create policy tenant_ai_settings_pro_select on public.tenant_ai_settings for select to authenticated
using ((select private.has_pro_access(barbershop_id)));
create policy tenant_ai_settings_pro_insert on public.tenant_ai_settings for insert to authenticated
with check ((select private.has_pro_access(barbershop_id)));
create policy tenant_ai_settings_pro_update on public.tenant_ai_settings for update to authenticated
using ((select private.has_pro_access(barbershop_id))) with check ((select private.has_pro_access(barbershop_id)));

grant select,insert,update on public.tenant_ai_settings to authenticated;

drop policy if exists crm_pipelines_tenant_all on public.crm_pipelines;
drop policy if exists crm_stages_tenant_all on public.crm_stages;
drop policy if exists crm_opportunities_tenant_all on public.crm_opportunities;
drop policy if exists automation_rules_tenant_all on public.automation_rules;
drop policy if exists automation_runs_tenant_read on public.automation_runs;

create policy crm_pipelines_pro_all on public.crm_pipelines for all to authenticated
using ((select private.has_pro_access(barbershop_id))) with check ((select private.has_pro_access(barbershop_id)));
create policy crm_stages_pro_all on public.crm_stages for all to authenticated
using ((select private.has_pro_access(barbershop_id))) with check ((select private.has_pro_access(barbershop_id)));
create policy crm_opportunities_pro_all on public.crm_opportunities for all to authenticated
using ((select private.has_pro_access(barbershop_id))) with check ((select private.has_pro_access(barbershop_id)));
create policy automation_rules_pro_all on public.automation_rules for all to authenticated
using ((select private.has_pro_access(barbershop_id))) with check ((select private.has_pro_access(barbershop_id)));
create policy automation_runs_pro_read on public.automation_runs for select to authenticated
using ((select private.has_pro_access(barbershop_id)));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('tenant-logos','tenant-logos',true,5242880,array['image/svg+xml','image/png','image/jpeg'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy tenant_logos_public_read on storage.objects for select to public
using (bucket_id='tenant-logos');
create policy tenant_logos_authenticated_insert on storage.objects for insert to authenticated
with check (
  bucket_id='tenant-logos' and exists (
    select 1 from public.profiles profile
    where profile.auth_user_id=(select auth.uid()) and profile.active
      and (profile.role='platform_admin' or profile.barbershop_id::text=(storage.foldername(name))[1])
  )
);
create policy tenant_logos_authenticated_update on storage.objects for update to authenticated
using (bucket_id='tenant-logos' and exists (
  select 1 from public.profiles profile where profile.auth_user_id=(select auth.uid()) and profile.active
    and (profile.role='platform_admin' or profile.barbershop_id::text=(storage.foldername(name))[1])
)) with check (bucket_id='tenant-logos');
create policy tenant_logos_authenticated_delete on storage.objects for delete to authenticated
using (bucket_id='tenant-logos' and exists (
  select 1 from public.profiles profile where profile.auth_user_id=(select auth.uid()) and profile.active
    and (profile.role='platform_admin' or profile.barbershop_id::text=(storage.foldername(name))[1])
));

;
