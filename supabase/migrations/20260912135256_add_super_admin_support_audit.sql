create table public.platform_support_access_logs (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  auth_user_id uuid not null default auth.uid(),
  action text not null default 'tenant_verification_opened'
    check (action in ('tenant_verification_opened')),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index platform_support_access_logs_lookup_idx
  on public.platform_support_access_logs (barbershop_id,created_at desc);

alter table public.platform_support_access_logs enable row level security;

create policy platform_support_access_logs_admin_select
on public.platform_support_access_logs for select to authenticated
using ((select private.is_platform_admin_profile(profile_id)));

create policy platform_support_access_logs_admin_insert
on public.platform_support_access_logs for insert to authenticated
with check (
  auth_user_id=(select auth.uid())
  and (select private.is_platform_admin_profile(profile_id))
  and (select private.is_tenant_member(barbershop_id))
);

grant select,insert on public.platform_support_access_logs to authenticated;

comment on table public.platform_support_access_logs is
  'Trilha imutável de entrada do Super Admin em tenants para suporte e verificação.';

;
