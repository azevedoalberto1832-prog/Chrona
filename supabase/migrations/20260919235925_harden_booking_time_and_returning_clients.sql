alter table public.barbershops
  add column if not exists timezone text not null default 'America/Sao_Paulo';

comment on column public.barbershops.timezone is
  'Fuso IANA usado para validar agenda e exibir horários locais do tenant.';

create or replace function public.get_returning_client(shop_slug text, client_phone text)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    (
      select jsonb_build_object('found',true,'name',client.name)
      from public.barbershops shop
      join public.subscriptions subscription on subscription.barbershop_id=shop.id
      join public.clients client on client.barbershop_id=shop.id
      where shop.slug=lower(shop_slug)
        and shop.active
        and subscription.status in ('trial','active')
        and client.phone_normalized=regexp_replace(client_phone,'\D','','g')
      limit 1
    ),
    jsonb_build_object('found',false)
  );
$$;

revoke all on function public.get_returning_client(text,text) from public;
grant execute on function public.get_returning_client(text,text) to anon,authenticated;

create or replace function public.get_available_slots(shop_slug text, professional uuid, service_ids uuid[], appt_date date)
returns table(slot time)
language sql
stable
security definer
set search_path=''
as $$
  with context as (
    select b.id shop_id,b.timezone,h.opening_time,h.closing_time,h.break_start,h.break_end,sum(s.duration_minutes)::int duration
    from public.barbershops b
    join public.subscriptions sub on sub.barbershop_id=b.id
    join public.business_hours h on h.barbershop_id=b.id and h.weekday=extract(dow from appt_date)::int and h.is_open
    join public.services s on s.barbershop_id=b.id and s.id=any(service_ids) and s.active
    where b.slug=lower(shop_slug) and b.active and sub.status in ('trial','active')
      and exists(select 1 from public.professionals p where p.id=professional and p.barbershop_id=b.id and p.active)
    group by b.id,b.timezone,h.opening_time,h.closing_time,h.break_start,h.break_end
  ), slots as (
    select c.*,g::time slot,(g+(c.duration||' minutes')::interval)::time slot_end
    from context c
    cross join lateral generate_series(appt_date+c.opening_time,appt_date+c.closing_time-(c.duration||' minutes')::interval,interval '15 minutes') g
  )
  select s.slot from slots s where
    (appt_date+s.slot)>(now() at time zone s.timezone)
    and (s.break_start is null or s.break_end is null or s.slot_end<=s.break_start or s.slot>=s.break_end)
    and not exists(select 1 from public.appointments a where a.professional_id=professional and a.appointment_date=appt_date and a.status in ('scheduled','confirmed') and s.slot<a.end_time and a.start_time<s.slot_end)
    and not exists(select 1 from public.schedule_exceptions e where e.barbershop_id=s.shop_id and e.exception_date=appt_date and (e.professional_id is null or e.professional_id=professional) and (e.is_closed or (s.slot<e.end_time and e.start_time<s.slot_end)))
  order by s.slot;
$$;

revoke all on function public.get_available_slots(text,uuid,uuid[],date) from public;
grant execute on function public.get_available_slots(text,uuid,uuid[],date) to anon,authenticated;

create or replace function public.create_public_appointment(shop_slug text, client_name text, client_phone text, client_birth date, opt_in boolean, professional uuid, service_ids uuid[], appt_date date, appt_start time, appt_notes text default null)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare v_shop uuid; v_client uuid; v_duration int; v_total numeric(12,2); v_end time; v_appt uuid; v_phone text; v_timezone text;
begin
  v_phone:=regexp_replace(client_phone,'\D','','g');
  if length(trim(client_name))<2 or v_phone !~ '^[0-9]{10,15}$' then
    raise exception 'Dados de agendamento inválidos' using errcode='22023';
  end if;

  select b.id,b.timezone into v_shop,v_timezone
  from public.barbershops b
  join public.subscriptions s on s.barbershop_id=b.id
  where b.slug=lower(shop_slug) and b.active and s.status in ('trial','active');
  if v_shop is null then raise exception 'Empresa indisponível' using errcode='P0001'; end if;
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
  insert into public.clients(barbershop_id,name,phone,phone_normalized,birth_date,whatsapp_opt_in,whatsapp_opt_in_at)
  values(v_shop,trim(client_name),client_phone,v_phone,client_birth,coalesce(opt_in,false),case when opt_in then now() end)
  on conflict(barbershop_id,phone_normalized) do update set
    phone=excluded.phone,
    birth_date=coalesce(public.clients.birth_date,excluded.birth_date),
    whatsapp_opt_in=public.clients.whatsapp_opt_in or excluded.whatsapp_opt_in,
    whatsapp_opt_in_at=case when public.clients.whatsapp_opt_in or excluded.whatsapp_opt_in then coalesce(public.clients.whatsapp_opt_in_at,excluded.whatsapp_opt_in_at,now()) end,
    updated_at=now()
  returning id into v_client;

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
