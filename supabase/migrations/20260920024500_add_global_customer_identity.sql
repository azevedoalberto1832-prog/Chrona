create table public.customer_identities (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  phone_normalized text not null unique,
  phone_verified_at timestamptz not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_identities_phone_valid check (phone_normalized ~ '^[0-9]{10,15}$'),
  constraint customer_identities_name_valid check (display_name is null or length(trim(display_name)) between 2 and 120)
);

comment on table public.customer_identities is
  'Identidade global do consumidor na Chrona. Dados comerciais e histórico permanecem nos clients isolados por tenant.';

alter table public.clients
  add column customer_identity_id uuid references public.customer_identities(id) on delete set null;

create unique index clients_tenant_customer_identity_uidx
  on public.clients (barbershop_id, customer_identity_id)
  where customer_identity_id is not null;
create index clients_customer_identity_fk_idx
  on public.clients (customer_identity_id)
  where customer_identity_id is not null;

create table public.customer_auth_settings (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  active boolean not null default false,
  meta_template_name text,
  meta_template_language text not null default 'pt_BR',
  terms_version text not null default '2026-09',
  privacy_version text not null default '2026-09',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_auth_template_required check (not active or nullif(trim(meta_template_name),'') is not null),
  constraint customer_auth_language_valid check (meta_template_language ~ '^[a-z]{2}_[A-Z]{2}$')
);

comment on table public.customer_auth_settings is
  'Ativação por tenant do login global Chrona por OTP entregue no WhatsApp. Nasce inativo até template Meta aprovado.';

insert into public.customer_auth_settings (barbershop_id)
select id from public.barbershops
on conflict (barbershop_id) do nothing;

create or replace function private.seed_customer_auth_settings()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.customer_auth_settings (barbershop_id) values (new.id)
  on conflict (barbershop_id) do nothing;
  return new;
end;
$$;

revoke all on function private.seed_customer_auth_settings() from public,anon,authenticated;
drop trigger if exists seed_customer_auth_settings on public.barbershops;
create trigger seed_customer_auth_settings
after insert on public.barbershops
for each row execute function private.seed_customer_auth_settings();

create table public.customer_consent_events (
  id uuid primary key default gen_random_uuid(),
  customer_identity_id uuid not null references public.customer_identities(id) on delete cascade,
  barbershop_id uuid references public.barbershops(id) on delete cascade,
  consent_type text not null check (consent_type in ('terms','privacy','marketing_whatsapp')),
  version text not null,
  accepted boolean not null,
  occurred_at timestamptz not null default now(),
  user_agent text,
  created_at timestamptz not null default now()
);

comment on table public.customer_consent_events is
  'Trilha imutável de aceite. Marketing por tenant é separado de termos e privacidade da plataforma.';

create index customer_consent_identity_idx
  on public.customer_consent_events (customer_identity_id, consent_type, occurred_at desc);
create index customer_consent_tenant_idx
  on public.customer_consent_events (barbershop_id, consent_type, occurred_at desc);

create table public.customer_auth_requests (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  phone_normalized text not null,
  intent text not null check (intent in ('booking','queue')),
  status text not null default 'prepared' check (status in ('prepared','delivered','failed','verified','expired')),
  requested_at timestamptz not null default now(),
  delivered_at timestamptz,
  error_code text,
  constraint customer_auth_requests_phone_valid check (phone_normalized ~ '^[0-9]{10,15}$')
);

comment on table public.customer_auth_requests is
  'Contexto efêmero e server-side que associa o OTP global Chrona ao tenant e à ação original; nunca armazena o código.';

create index customer_auth_requests_phone_idx
  on public.customer_auth_requests (phone_normalized, requested_at desc);
create index customer_auth_requests_rate_idx
  on public.customer_auth_requests (barbershop_id, phone_normalized, requested_at desc);

create or replace function private.sync_customer_identity_from_auth()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare normalized_phone text;
begin
  normalized_phone := regexp_replace(coalesce(new.phone,''),'\D','','g');
  if new.phone_confirmed_at is null or normalized_phone !~ '^[0-9]{10,15}$' then
    return new;
  end if;

  insert into public.customer_identities (auth_user_id,phone_normalized,phone_verified_at)
  values (new.id,normalized_phone,new.phone_confirmed_at)
  on conflict (auth_user_id) do update set
    phone_normalized=excluded.phone_normalized,
    phone_verified_at=excluded.phone_verified_at,
    updated_at=now();
  return new;
end;
$$;

revoke all on function private.sync_customer_identity_from_auth() from public,anon,authenticated;
drop trigger if exists sync_customer_identity_from_auth on auth.users;
create trigger sync_customer_identity_from_auth
after insert or update of phone,phone_confirmed_at on auth.users
for each row execute function private.sync_customer_identity_from_auth();

insert into public.customer_identities (auth_user_id,phone_normalized,phone_verified_at)
select id,regexp_replace(phone,'\D','','g'),phone_confirmed_at
from auth.users
where phone_confirmed_at is not null and regexp_replace(coalesce(phone,''),'\D','','g') ~ '^[0-9]{10,15}$'
on conflict (auth_user_id) do update set
  phone_normalized=excluded.phone_normalized,
  phone_verified_at=excluded.phone_verified_at,
  updated_at=now();

create or replace function public.prepare_customer_phone_auth(shop_slug text, client_phone text, requested_intent text default 'booking')
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target_shop public.barbershops;
  settings public.customer_auth_settings;
  normalized_phone text := regexp_replace(coalesce(client_phone,''),'\D','','g');
  target_intent text := lower(coalesce(requested_intent,'booking'));
  request_id uuid;
begin
  if normalized_phone !~ '^[0-9]{10,15}$' or target_intent not in ('booking','queue') then
    raise exception 'Dados de acesso inválidos' using errcode='22023';
  end if;

  select shop.* into target_shop
  from public.barbershops shop
  join public.subscriptions subscription on subscription.barbershop_id=shop.id
  where shop.slug=lower(shop_slug) and shop.active
    and (subscription.status='active' or (subscription.status='trial' and (subscription.trial_ends_at is null or subscription.trial_ends_at>now())));
  if target_shop.id is null then raise exception 'Empresa indisponível' using errcode='P0001'; end if;

  select auth_settings.* into settings
  from public.customer_auth_settings auth_settings
  where auth_settings.barbershop_id=target_shop.id;

  if not coalesce(settings.active,false)
    or nullif(trim(settings.meta_template_name),'') is null
    or not exists (
      select 1 from public.whatsapp_connections connection
      where connection.barbershop_id=target_shop.id
        and connection.status='connected'
        and connection.phone_number_id is not null
        and connection.secret_reference is not null
    )
  then
    return jsonb_build_object('ready',false,'mode','legacy','reason','whatsapp_otp_pending');
  end if;

  if (select count(*) from public.customer_auth_requests request
      where request.barbershop_id=target_shop.id and request.phone_normalized=normalized_phone
        and request.requested_at>now()-interval '15 minutes') >= 3 then
    raise exception 'Aguarde alguns minutos antes de solicitar outro código' using errcode='P0001';
  end if;

  insert into public.customer_auth_requests (barbershop_id,phone_normalized,intent)
  values (target_shop.id,normalized_phone,target_intent)
  returning id into request_id;

  return jsonb_build_object(
    'ready',true,
    'mode','whatsapp_otp',
    'requestId',request_id,
    'tenantName',target_shop.name,
    'termsVersion',settings.terms_version,
    'privacyVersion',settings.privacy_version
  );
end;
$$;

create or replace function public.get_customer_auth_delivery_context(target_phone text)
returns jsonb
language sql
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'requestId',request.id,
    'barbershopId',shop.id,
    'tenantName',shop.name,
    'phone',request.phone_normalized,
    'phoneNumberId',connection.phone_number_id,
    'graphApiVersion',connection.graph_api_version,
    'accessToken',secret.decrypted_secret,
    'templateName',settings.meta_template_name,
    'templateLanguage',settings.meta_template_language
  )
  from public.customer_auth_requests request
  join public.barbershops shop on shop.id=request.barbershop_id and shop.active
  join public.customer_auth_settings settings on settings.barbershop_id=shop.id and settings.active
  join public.whatsapp_connections connection on connection.barbershop_id=shop.id and connection.status='connected'
  join vault.decrypted_secrets secret on secret.id::text=connection.secret_reference
  where request.phone_normalized=regexp_replace(target_phone,'\D','','g')
    and request.status='prepared'
    and request.requested_at>now()-interval '10 minutes'
  order by request.requested_at desc
  limit 1;
$$;

create or replace function public.finish_customer_auth_delivery(target_request_id uuid, outcome text, failure_code text default null)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if outcome not in ('delivered','failed') then raise exception 'Resultado inválido' using errcode='22023'; end if;
  update public.customer_auth_requests
  set status=outcome,
      delivered_at=case when outcome='delivered' then now() else delivered_at end,
      error_code=case when outcome='failed' then left(coalesce(failure_code,'unknown'),120) else null end
  where id=target_request_id and status='prepared';
end;
$$;

create or replace function public.get_customer_context(shop_slug text)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'authenticated',true,
    'identityId',identity.id,
    'phone',identity.phone_normalized,
    'name',coalesce(client.name,identity.display_name),
    'clientId',client.id,
    'profileComplete',client.id is not null,
    'tenantName',shop.name,
    'termsVersion',settings.terms_version,
    'privacyVersion',settings.privacy_version
  )
  from public.customer_identities identity
  join public.barbershops shop on shop.slug=lower(shop_slug) and shop.active
  join public.customer_auth_settings settings on settings.barbershop_id=shop.id
  left join public.clients client on client.barbershop_id=shop.id and client.customer_identity_id=identity.id
  where identity.auth_user_id=(select auth.uid());
$$;

create or replace function public.complete_customer_profile(
  shop_slug text,
  customer_name text,
  accept_terms boolean,
  accept_privacy boolean,
  marketing_whatsapp boolean default false,
  client_birth date default null,
  browser_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  identity public.customer_identities;
  shop public.barbershops;
  settings public.customer_auth_settings;
  target_client public.clients;
begin
  if length(trim(coalesce(customer_name,''))) not between 2 and 120 or not accept_terms or not accept_privacy then
    raise exception 'Confirme seu nome, os termos e a privacidade' using errcode='22023';
  end if;

  select * into identity from public.customer_identities where auth_user_id=(select auth.uid());
  if identity.id is null then raise exception 'Confirme seu telefone antes de continuar' using errcode='42501'; end if;

  select target.* into shop from public.barbershops target where target.slug=lower(shop_slug) and target.active;
  select target.* into settings from public.customer_auth_settings target where target.barbershop_id=shop.id and target.active;
  if shop.id is null or settings.barbershop_id is null then raise exception 'Acesso por telefone indisponível' using errcode='P0001'; end if;

  update public.customer_identities
  set display_name=trim(customer_name),updated_at=now()
  where id=identity.id;

  insert into public.clients (barbershop_id,customer_identity_id,name,phone,phone_normalized,birth_date,whatsapp_opt_in,whatsapp_opt_in_at)
  values (shop.id,identity.id,trim(customer_name),identity.phone_normalized,identity.phone_normalized,client_birth,marketing_whatsapp,case when marketing_whatsapp then now() end)
  on conflict (barbershop_id,phone_normalized) do update set
    customer_identity_id=identity.id,
    name=coalesce(nullif(trim(public.clients.name),''),excluded.name),
    birth_date=coalesce(public.clients.birth_date,excluded.birth_date),
    whatsapp_opt_in=excluded.whatsapp_opt_in,
    whatsapp_opt_in_at=case when excluded.whatsapp_opt_in then coalesce(public.clients.whatsapp_opt_in_at,now()) else null end,
    updated_at=now()
  returning * into target_client;

  insert into public.customer_consent_events (customer_identity_id,barbershop_id,consent_type,version,accepted,user_agent)
  values
    (identity.id,null,'terms',settings.terms_version,true,left(browser_user_agent,500)),
    (identity.id,null,'privacy',settings.privacy_version,true,left(browser_user_agent,500)),
    (identity.id,shop.id,'marketing_whatsapp',settings.terms_version,marketing_whatsapp,left(browser_user_agent,500));

  update public.customer_auth_requests
  set status='verified'
  where phone_normalized=identity.phone_normalized and barbershop_id=shop.id
    and status='delivered' and requested_at>now()-interval '15 minutes';

  return jsonb_build_object('clientId',target_client.id,'name',target_client.name,'phone',target_client.phone_normalized,'profileComplete',true);
end;
$$;

alter table public.customer_identities enable row level security;
alter table public.customer_auth_settings enable row level security;
alter table public.customer_consent_events enable row level security;
alter table public.customer_auth_requests enable row level security;

create policy customer_identities_self_select on public.customer_identities
for select to authenticated using (auth_user_id=(select auth.uid()));
create policy customer_auth_settings_tenant_select on public.customer_auth_settings
for select to authenticated using ((select private.is_tenant_member(barbershop_id)));
create policy customer_auth_settings_owner_update on public.customer_auth_settings
for update to authenticated
using (exists(select 1 from public.profiles profile where profile.auth_user_id=(select auth.uid()) and profile.active and (profile.role='platform_admin' or (profile.role='owner' and profile.barbershop_id=customer_auth_settings.barbershop_id))))
with check (exists(select 1 from public.profiles profile where profile.auth_user_id=(select auth.uid()) and profile.active and (profile.role='platform_admin' or (profile.role='owner' and profile.barbershop_id=customer_auth_settings.barbershop_id))));
create policy customer_consent_self_select on public.customer_consent_events
for select to authenticated using (exists(select 1 from public.customer_identities identity where identity.id=customer_identity_id and identity.auth_user_id=(select auth.uid())));

revoke all on table public.customer_identities,public.customer_auth_settings,public.customer_consent_events,public.customer_auth_requests from anon,authenticated;
grant select on table public.customer_identities,public.customer_consent_events to authenticated;
grant select,update on table public.customer_auth_settings to authenticated;

revoke all on function public.prepare_customer_phone_auth(text,text,text) from public;
revoke all on function public.get_customer_auth_delivery_context(text) from public,anon,authenticated;
revoke all on function public.finish_customer_auth_delivery(uuid,text,text) from public,anon,authenticated;
revoke all on function public.get_customer_context(text) from public;
revoke all on function public.complete_customer_profile(text,text,boolean,boolean,boolean,date,text) from public;
grant execute on function public.prepare_customer_phone_auth(text,text,text) to anon,authenticated;
grant execute on function public.get_customer_auth_delivery_context(text) to service_role;
grant execute on function public.finish_customer_auth_delivery(uuid,text,text) to service_role;
grant execute on function public.get_customer_context(text) to authenticated;
grant execute on function public.complete_customer_profile(text,text,boolean,boolean,boolean,date,text) to authenticated;

create or replace function public.get_returning_client(shop_slug text, client_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  target_shop uuid;
  auth_required boolean := false;
  normalized_phone text := regexp_replace(coalesce(client_phone,''),'\D','','g');
  identity_id uuid;
  result jsonb;
begin
  select shop.id,coalesce(settings.active,false) into target_shop,auth_required
  from public.barbershops shop
  join public.subscriptions subscription on subscription.barbershop_id=shop.id
  left join public.customer_auth_settings settings on settings.barbershop_id=shop.id
  where shop.slug=lower(shop_slug) and shop.active
    and (subscription.status='active' or (subscription.status='trial' and (subscription.trial_ends_at is null or subscription.trial_ends_at>now())));

  if target_shop is null then return jsonb_build_object('found',false); end if;
  if auth_required then
    select identity.id into identity_id
    from public.customer_identities identity
    where identity.auth_user_id=(select auth.uid()) and identity.phone_normalized=normalized_phone;
    if identity_id is null then return jsonb_build_object('found',false,'verificationRequired',true); end if;
  end if;

  select jsonb_build_object('found',true,'name',client.name) into result
  from public.clients client
  where client.barbershop_id=target_shop and client.phone_normalized=normalized_phone
    and (not auth_required or client.customer_identity_id=identity_id)
  limit 1;
  return coalesce(result,jsonb_build_object('found',false,'verificationRequired',auth_required));
end;
$$;

revoke all on function public.get_returning_client(text,text) from public;
grant execute on function public.get_returning_client(text,text) to anon,authenticated;

create or replace function public.create_public_appointment(shop_slug text, client_name text, client_phone text, client_birth date, opt_in boolean, professional uuid, service_ids uuid[], appt_date date, appt_start time, appt_notes text default null)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_shop uuid; v_client uuid; v_duration int; v_total numeric(12,2); v_end time; v_appt uuid;
  v_phone text; v_timezone text; v_auth_required boolean := false; v_identity public.customer_identities;
  v_staff_authorized boolean := false; v_effective_name text;
begin
  v_phone:=regexp_replace(client_phone,'\D','','g');
  if length(trim(client_name))<2 or v_phone !~ '^[0-9]{10,15}$' then
    raise exception 'Dados de agendamento inválidos' using errcode='22023';
  end if;

  select b.id,b.timezone,coalesce(settings.active,false) into v_shop,v_timezone,v_auth_required
  from public.barbershops b
  join public.subscriptions s on s.barbershop_id=b.id
  left join public.customer_auth_settings settings on settings.barbershop_id=b.id
  where b.slug=lower(shop_slug) and b.active
    and (s.status='active' or (s.status='trial' and (s.trial_ends_at is null or s.trial_ends_at>now())));
  if v_shop is null then raise exception 'Empresa indisponível' using errcode='P0001'; end if;

  select exists(
    select 1 from public.profiles profile
    where profile.auth_user_id=(select auth.uid()) and profile.active
      and (profile.role='platform_admin' or profile.barbershop_id=v_shop)
  ) into v_staff_authorized;

  if v_auth_required and not v_staff_authorized then
    select * into v_identity from public.customer_identities identity
    where identity.auth_user_id=(select auth.uid()) and identity.phone_normalized=v_phone;
    if v_identity.id is null then raise exception 'Confirme seu WhatsApp antes de agendar' using errcode='42501'; end if;
    select client.id,client.name into v_client,v_effective_name
    from public.clients client
    where client.barbershop_id=v_shop and client.customer_identity_id=v_identity.id;
    if v_client is null then raise exception 'Complete seu cadastro antes de agendar' using errcode='42501'; end if;
  else
    v_effective_name:=trim(client_name);
  end if;

  if (appt_date+appt_start)<=(now() at time zone v_timezone) then
    raise exception 'Escolha um horário futuro' using errcode='22023';
  end if;
  if not exists(select 1 from public.professionals p where p.id=professional and p.barbershop_id=v_shop and p.active) then
    raise exception 'Profissional inválido' using errcode='22023';
  end if;

  select sum(s.duration_minutes)::int,sum(s.price) into v_duration,v_total
  from public.services s where s.id=any(service_ids) and s.barbershop_id=v_shop and s.active;
  if v_duration is null or (select count(*) from public.services s where s.id=any(service_ids) and s.barbershop_id=v_shop and s.active)<>cardinality(service_ids) then
    raise exception 'Serviço inválido' using errcode='22023';
  end if;
  if not exists(select 1 from public.get_available_slots(shop_slug,professional,service_ids,appt_date) available where available.slot=appt_start) then
    raise exception 'Este horário não está mais disponível. Escolha outro horário.' using errcode='22023';
  end if;

  v_end:=appt_start+(v_duration||' minutes')::interval;
  if v_client is null then
    insert into public.clients(barbershop_id,customer_identity_id,name,phone,phone_normalized,birth_date,whatsapp_opt_in,whatsapp_opt_in_at)
    values(v_shop,v_identity.id,v_effective_name,client_phone,v_phone,client_birth,coalesce(opt_in,false),case when opt_in then now() end)
    on conflict(barbershop_id,phone_normalized) do update set
      customer_identity_id=coalesce(public.clients.customer_identity_id,excluded.customer_identity_id),
      phone=excluded.phone,
      birth_date=coalesce(public.clients.birth_date,excluded.birth_date),
      whatsapp_opt_in=public.clients.whatsapp_opt_in or excluded.whatsapp_opt_in,
      whatsapp_opt_in_at=case when public.clients.whatsapp_opt_in or excluded.whatsapp_opt_in then coalesce(public.clients.whatsapp_opt_in_at,excluded.whatsapp_opt_in_at,now()) end,
      updated_at=now()
    returning id into v_client;
  end if;

  insert into public.appointments(barbershop_id,client_id,professional_id,appointment_date,start_time,end_time,duration_minutes,total,notes)
  values(v_shop,v_client,professional,appt_date,appt_start,v_end,v_duration,v_total,appt_notes) returning id into v_appt;
  insert into public.appointment_services(appointment_id,service_id,service_name_snapshot,price_snapshot,duration_snapshot)
  select v_appt,s.id,s.name,s.price,s.duration_minutes from public.services s where s.id=any(service_ids) and s.barbershop_id=v_shop;
  return v_appt;
exception when exclusion_violation then
  raise exception 'Este horário acabou de ser reservado. Escolha outro horário.' using errcode='23P01';
end;
$$;

revoke all on function public.create_public_appointment(text,text,text,date,boolean,uuid,uuid[],date,time,text) from public;
grant execute on function public.create_public_appointment(text,text,text,date,boolean,uuid,uuid[],date,time,text) to anon,authenticated;
