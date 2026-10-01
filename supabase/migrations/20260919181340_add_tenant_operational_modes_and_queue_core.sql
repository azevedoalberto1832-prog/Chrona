-- Operational modes and reusable queue core.
-- Existing tenants remain appointment-only unless explicitly changed.

alter table public.barbershops
  add column if not exists operational_mode text not null default 'appointment';

alter table public.barbershops
  drop constraint if exists barbershops_operational_mode_check;
alter table public.barbershops
  add constraint barbershops_operational_mode_check
  check (operational_mode in ('appointment', 'queue', 'hybrid'));

create type public.queue_entry_status as enum (
  'waiting',
  'called',
  'in_service',
  'completed',
  'cancelled',
  'no_show'
);

create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  client_id uuid not null,
  professional_id uuid,
  queue_date date not null default current_date,
  queue_number integer not null check (queue_number > 0),
  public_token uuid not null default gen_random_uuid() unique,
  status public.queue_entry_status not null default 'waiting',
  estimated_duration_minutes integer not null check (estimated_duration_minutes between 5 and 720),
  notes text,
  joined_at timestamptz not null default now(),
  called_at timestamptz,
  service_started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint queue_entries_client_fk foreign key (barbershop_id, client_id)
    references public.clients(barbershop_id, id),
  constraint queue_entries_professional_fk foreign key (barbershop_id, professional_id)
    references public.professionals(barbershop_id, id),
  unique (barbershop_id, queue_date, queue_number),
  unique (barbershop_id, id)
);

create table public.queue_entry_services (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  queue_entry_id uuid not null,
  service_id uuid,
  service_name_snapshot text not null,
  price_snapshot numeric(12,2) not null check (price_snapshot >= 0),
  duration_snapshot integer not null check (duration_snapshot > 0),
  created_at timestamptz not null default now(),
  constraint queue_entry_services_entry_fk foreign key (barbershop_id, queue_entry_id)
    references public.queue_entries(barbershop_id, id) on delete cascade,
  constraint queue_entry_services_service_fk foreign key (barbershop_id, service_id)
    references public.services(barbershop_id, id) on delete restrict
);

create index queue_entries_tenant_day_status_idx
  on public.queue_entries(barbershop_id, queue_date, status, queue_number);
create index queue_entries_client_idx on public.queue_entries(client_id);
create index queue_entries_professional_idx on public.queue_entries(professional_id);
create unique index queue_entries_one_active_per_client_idx
  on public.queue_entries(barbershop_id, client_id, queue_date)
  where status in ('waiting', 'called', 'in_service');
create index queue_entry_services_entry_idx on public.queue_entry_services(queue_entry_id);
create index queue_entry_services_service_idx on public.queue_entry_services(service_id);

alter table public.queue_entries enable row level security;
alter table public.queue_entry_services enable row level security;

create policy queue_entries_tenant_all on public.queue_entries
  for all to authenticated
  using ((select private.is_tenant_member(barbershop_id)))
  with check ((select private.is_tenant_member(barbershop_id)));

create policy queue_entry_services_tenant_all on public.queue_entry_services
  for all to authenticated
  using ((select private.is_tenant_member(barbershop_id)))
  with check ((select private.is_tenant_member(barbershop_id)));

grant select, insert, update, delete on public.queue_entries to authenticated;
grant select, insert, update, delete on public.queue_entry_services to authenticated;

create or replace function public.join_public_queue(
  shop_slug text,
  client_name text,
  client_phone text,
  opt_in boolean,
  professional uuid,
  service_ids uuid[],
  queue_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shop uuid;
  v_client uuid;
  v_entry uuid;
  v_token uuid;
  v_number integer;
  v_duration integer;
  v_phone text;
begin
  v_phone := regexp_replace(client_phone, '\D', '', 'g');
  if length(trim(client_name)) < 2 or v_phone !~ '^[0-9]{10,15}$' then
    raise exception 'Informe nome e WhatsApp válidos' using errcode = '22023';
  end if;
  if coalesce(cardinality(service_ids), 0) = 0 then
    raise exception 'Selecione ao menos um serviço' using errcode = '22023';
  end if;

  select b.id into v_shop
  from public.barbershops b
  join public.subscriptions sub on sub.barbershop_id = b.id
  where b.slug = lower(shop_slug)
    and b.active
    and b.operational_mode in ('queue', 'hybrid')
    and sub.status in ('trial', 'active');
  if v_shop is null then
    raise exception 'Fila indisponível neste estabelecimento' using errcode = 'P0001';
  end if;

  if professional is not null and not exists (
    select 1 from public.professionals p
    where p.id = professional and p.barbershop_id = v_shop and p.active
  ) then
    raise exception 'Profissional inválido' using errcode = '22023';
  end if;

  select sum(s.duration_minutes)::integer into v_duration
  from public.services s
  where s.id = any(service_ids) and s.barbershop_id = v_shop and s.active;
  if v_duration is null or (
    select count(*) from public.services s
    where s.id = any(service_ids) and s.barbershop_id = v_shop and s.active
  ) <> cardinality(service_ids) then
    raise exception 'Serviço inválido' using errcode = '22023';
  end if;

  insert into public.clients(
    barbershop_id, name, phone, phone_normalized, whatsapp_opt_in, whatsapp_opt_in_at
  ) values (
    v_shop, trim(client_name), client_phone, v_phone, coalesce(opt_in, false),
    case when opt_in then now() end
  )
  on conflict(barbershop_id, phone_normalized) do update
    set name = excluded.name,
        whatsapp_opt_in = excluded.whatsapp_opt_in,
        whatsapp_opt_in_at = case
          when excluded.whatsapp_opt_in then coalesce(public.clients.whatsapp_opt_in_at, now())
        end,
        updated_at = now()
  returning id into v_client;

  -- Serialize the daily sequence per tenant without exposing an incrementing global id.
  perform pg_advisory_xact_lock(hashtextextended(v_shop::text || current_date::text, 0));
  select coalesce(max(q.queue_number), 0) + 1 into v_number
  from public.queue_entries q
  where q.barbershop_id = v_shop and q.queue_date = current_date;

  insert into public.queue_entries(
    barbershop_id, client_id, professional_id, queue_number,
    estimated_duration_minutes, notes
  ) values (
    v_shop, v_client, professional, v_number, v_duration, nullif(trim(queue_notes), '')
  ) returning id, public_token into v_entry, v_token;

  insert into public.queue_entry_services(
    barbershop_id, queue_entry_id, service_id, service_name_snapshot, price_snapshot, duration_snapshot
  )
  select v_shop, v_entry, s.id, s.name, s.price, s.duration_minutes
  from public.services s
  where s.id = any(service_ids) and s.barbershop_id = v_shop;

  return public.get_public_queue_ticket(v_token);
exception
  when unique_violation then
    raise exception 'Este WhatsApp já possui um atendimento ativo na fila' using errcode = '23505';
end;
$$;

create or replace function public.get_public_queue_ticket(ticket_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ticket as (
    select q.*, b.name shop_name,
      coalesce((select count(*)::integer
        from public.queue_entries ahead
        where ahead.barbershop_id = q.barbershop_id
          and ahead.queue_date = q.queue_date
          and ahead.status = 'waiting'
          and ahead.queue_number <= q.queue_number), 0) as position,
      greatest(1, (select count(*)::integer from public.professionals p
        where p.barbershop_id = q.barbershop_id and p.active)) as active_professionals
    from public.queue_entries q
    join public.barbershops b on b.id = q.barbershop_id
    where q.public_token = ticket_token
  )
  select jsonb_build_object(
    'token', t.public_token,
    'number', t.queue_number,
    'status', t.status,
    'position', case when t.status = 'waiting' then t.position else 0 end,
    'estimated_wait_minutes', case when t.status = 'waiting' then ceil(coalesce((
      select sum(a.estimated_duration_minutes)
      from public.queue_entries a
      where a.barbershop_id = t.barbershop_id
        and a.queue_date = t.queue_date
        and a.status in ('waiting', 'called', 'in_service')
        and a.queue_number < t.queue_number
    ), 0)::numeric / t.active_professionals)::integer else 0 end,
    'shop_name', t.shop_name,
    'professional_name', p.name,
    'services', coalesce((select jsonb_agg(s.service_name_snapshot order by s.created_at)
      from public.queue_entry_services s where s.queue_entry_id = t.id), '[]'::jsonb),
    'joined_at', t.joined_at,
    'called_at', t.called_at,
    'service_started_at', t.service_started_at,
    'completed_at', t.completed_at
  )
  from ticket t
  left join public.professionals p on p.id = t.professional_id;
$$;

create or replace function public.transition_queue_entry(
  target_entry uuid,
  next_status public.queue_entry_status
)
returns public.queue_entries
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_entry public.queue_entries;
  updated_entry public.queue_entries;
begin
  select * into current_entry from public.queue_entries where id = target_entry for update;
  if current_entry.id is null or not (select private.is_tenant_member(current_entry.barbershop_id)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not (
    (current_entry.status = 'waiting' and next_status in ('called', 'cancelled', 'no_show')) or
    (current_entry.status = 'called' and next_status in ('in_service', 'waiting', 'cancelled', 'no_show')) or
    (current_entry.status = 'in_service' and next_status in ('completed', 'cancelled'))
  ) then
    raise exception 'Transição de status inválida' using errcode = '22023';
  end if;

  update public.queue_entries set
    status = next_status,
    called_at = case when next_status = 'called' then now() else called_at end,
    service_started_at = case when next_status = 'in_service' then now() else service_started_at end,
    completed_at = case when next_status = 'completed' then now() else completed_at end,
    cancelled_at = case when next_status in ('cancelled', 'no_show') then now() else cancelled_at end,
    updated_at = now()
  where id = target_entry
  returning * into updated_entry;
  return updated_entry;
end;
$$;

revoke all on function public.join_public_queue(text,text,text,boolean,uuid,uuid[],text) from public;
grant execute on function public.join_public_queue(text,text,text,boolean,uuid,uuid[],text) to anon, authenticated;
revoke all on function public.get_public_queue_ticket(uuid) from public;
grant execute on function public.get_public_queue_ticket(uuid) to anon, authenticated;
revoke all on function public.transition_queue_entry(uuid,public.queue_entry_status) from public, anon;
grant execute on function public.transition_queue_entry(uuid,public.queue_entry_status) to authenticated;

comment on column public.barbershops.operational_mode is
  'appointment preserves the current schedule flow; queue enables walk-in queue; hybrid enables both.';
comment on column public.queue_entries.public_token is
  'Opaque capability token used only by the safe public ticket RPC. Never expose queue entry ids publicly.';

;
