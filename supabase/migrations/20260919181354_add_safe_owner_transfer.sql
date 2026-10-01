-- Two-step tenant ownership transfer.
-- The previous owner remains active until a platform admin explicitly deactivates it.

create or replace function public.add_tenant_owner(
  actor_auth_user_id uuid,
  owner_auth_user_id uuid,
  target_barbershop_id uuid,
  owner_name text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  tenant_slug text;
  new_profile uuid;
begin
  if not exists (
    select 1 from public.profiles p
    where p.auth_user_id = actor_auth_user_id
      and p.active and p.role = 'platform_admin'
  ) then
    raise exception 'Acesso exclusivo da administração Chrona' using errcode = '42501';
  end if;
  select b.slug into tenant_slug from public.barbershops b where b.id = target_barbershop_id;
  if tenant_slug is null then
    raise exception 'Empresa não encontrada' using errcode = 'P0002';
  end if;
  if not exists (select 1 from auth.users u where u.id = owner_auth_user_id) then
    raise exception 'O convite do novo proprietário não foi encontrado' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles p where p.auth_user_id = owner_auth_user_id) then
    raise exception 'Este e-mail já está vinculado a uma conta Chrona' using errcode = '23505';
  end if;
  if length(trim(coalesce(owner_name, ''))) < 2 or length(trim(owner_name)) > 120 then
    raise exception 'Informe o nome do novo proprietário' using errcode = '22023';
  end if;

  insert into public.profiles(auth_user_id, barbershop_id, name, role, active)
  values(owner_auth_user_id, target_barbershop_id, trim(owner_name), 'owner', true)
  returning id into new_profile;

  return jsonb_build_object(
    'id', target_barbershop_id,
    'slug', tenant_slug,
    'profileId', new_profile,
    'ownerUserId', owner_auth_user_id
  );
end;
$$;

create or replace function public.deactivate_tenant_owner(
  actor_auth_user_id uuid,
  target_barbershop_id uuid,
  target_profile_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_owners integer;
begin
  if not exists (
    select 1 from public.profiles p
    where p.auth_user_id = actor_auth_user_id
      and p.active and p.role = 'platform_admin'
  ) then
    raise exception 'Acesso exclusivo da administração Chrona' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = target_profile_id
      and p.barbershop_id = target_barbershop_id
      and p.role = 'owner' and p.active
  ) then
    raise exception 'Proprietário ativo não encontrado' using errcode = 'P0002';
  end if;
  select count(*) into remaining_owners
  from public.profiles p
  where p.barbershop_id = target_barbershop_id
    and p.role = 'owner' and p.active
    and p.id <> target_profile_id;
  if remaining_owners < 1 then
    raise exception 'Convide e valide outro proprietário antes de remover este acesso' using errcode = '23514';
  end if;

  update public.profiles set active = false where id = target_profile_id;
  return jsonb_build_object('profileId', target_profile_id, 'active', false);
end;
$$;

revoke all on function public.add_tenant_owner(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.add_tenant_owner(uuid,uuid,uuid,text) to service_role;
revoke all on function public.deactivate_tenant_owner(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.deactivate_tenant_owner(uuid,uuid,uuid) to service_role;

;
