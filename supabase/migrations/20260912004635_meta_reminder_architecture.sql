create or replace function private.is_tenant_owner(target_barbershop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.auth_user_id = (select auth.uid())
      and profile.active
      and (
        profile.role = 'platform_admin'
        or (profile.role = 'owner' and profile.barbershop_id = target_barbershop_id)
      )
  );
$$;

revoke all on function private.is_tenant_owner(uuid) from public, anon;
grant execute on function private.is_tenant_owner(uuid) to authenticated;

create or replace function private.normalize_whatsapp_number(raw_phone text, country_code text default '55')
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits text := regexp_replace(coalesce(raw_phone, ''), '[^0-9]', '', 'g');
  safe_country_code text := regexp_replace(coalesce(country_code, '55'), '[^0-9]', '', 'g');
  normalized text;
begin
  if digits = '' then return null; end if;
  if length(digits) <= 11 then normalized := safe_country_code || digits;
  else normalized := digits;
  end if;
  if normalized !~ '^[1-9][0-9]{9,14}$' then return null; end if;
  return normalized;
end;
$$;

revoke all on function private.normalize_whatsapp_number(text, text) from public, anon, authenticated;

create table public.tenant_notification_settings (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  owner_name text,
  owner_phone text,
  owner_phone_normalized text,
  owner_whatsapp_opt_in boolean not null default false,
  owner_whatsapp_opt_in_at timestamptz,
  default_country_code text not null default '55',
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_notification_owner_name_valid
    check (owner_name is null or length(btrim(owner_name)) between 2 and 120),
  constraint tenant_notification_country_code_valid
    check (default_country_code ~ '^[1-9][0-9]{0,2}$'),
  constraint tenant_notification_phone_valid
    check (owner_phone_normalized is null or owner_phone_normalized ~ '^[1-9][0-9]{9,14}$'),
  constraint tenant_notification_opt_in_valid
    check (not owner_whatsapp_opt_in or owner_phone_normalized is not null)
);

create or replace function private.sync_tenant_notification_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.owner_name := nullif(btrim(new.owner_name), '');
  new.owner_phone := nullif(btrim(new.owner_phone), '');
  new.owner_phone_normalized := private.normalize_whatsapp_number(new.owner_phone, new.default_country_code);
  if new.owner_phone is not null and new.owner_phone_normalized is null then
    raise exception 'Informe o WhatsApp do responsável com DDD' using errcode = '22023';
  end if;
  if new.owner_whatsapp_opt_in and new.owner_whatsapp_opt_in_at is null then
    new.owner_whatsapp_opt_in_at := now();
  elsif not new.owner_whatsapp_opt_in then
    new.owner_whatsapp_opt_in_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.sync_tenant_notification_settings() from public, anon, authenticated;

create trigger tenant_notification_settings_sync
before insert or update on public.tenant_notification_settings
for each row execute function private.sync_tenant_notification_settings();

alter table public.tenant_notification_settings enable row level security;

create policy tenant_notification_settings_member_select
on public.tenant_notification_settings for select to authenticated
using ((select private.is_tenant_member(barbershop_id)));

create policy tenant_notification_settings_owner_insert
on public.tenant_notification_settings for insert to authenticated
with check ((select private.is_tenant_owner(barbershop_id)));

create policy tenant_notification_settings_owner_update
on public.tenant_notification_settings for update to authenticated
using ((select private.is_tenant_owner(barbershop_id)))
with check ((select private.is_tenant_owner(barbershop_id)));

grant select, insert, update on public.tenant_notification_settings to authenticated;

create table public.personal_reminders (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  title text not null,
  message_body text not null,
  starts_at timestamptz not null,
  repeat_every_days smallint,
  next_run_at timestamptz not null,
  active boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_reminders_title_valid check (length(btrim(title)) between 2 and 120),
  constraint personal_reminders_body_valid check (length(btrim(message_body)) between 2 and 500),
  constraint personal_reminders_repeat_valid check (repeat_every_days is null or repeat_every_days between 1 and 365),
  unique (barbershop_id, id)
);

create index personal_reminders_due_idx
on public.personal_reminders (next_run_at)
where active;

alter table public.personal_reminders enable row level security;

create policy personal_reminders_owner_all
on public.personal_reminders for all to authenticated
using ((select private.is_tenant_owner(barbershop_id)))
with check ((select private.is_tenant_owner(barbershop_id)));

grant select, insert, update, delete on public.personal_reminders to authenticated;

alter table public.automation_rules
  drop constraint automation_rules_trigger_type_check,
  add column recipient_type text not null default 'client',
  add column lead_minutes integer not null default 0,
  add constraint automation_rules_trigger_type_check check (
    trigger_type in (
      'birthday', 'return_due', 'appointment_created', 'appointment_reminder',
      'appointment_completed', 'crm_stage_changed', 'personal_reminder'
    )
  ),
  add constraint automation_rules_recipient_type_check
    check (recipient_type in ('client', 'owner')),
  add constraint automation_rules_lead_minutes_check
    check (lead_minutes between 0 and 10080);

alter table public.automation_runs
  add column recipient_type text not null default 'client',
  add column appointment_id uuid references public.appointments(id) on delete cascade,
  add column personal_reminder_id uuid references public.personal_reminders(id) on delete cascade,
  add constraint automation_runs_recipient_type_check
    check (recipient_type in ('client', 'owner'));

create index automation_runs_appointment_idx
on public.automation_runs (barbershop_id, appointment_id)
where appointment_id is not null;

create index automation_runs_personal_reminder_idx
on public.automation_runs (barbershop_id, personal_reminder_id)
where personal_reminder_id is not null;

alter table public.whatsapp_messages
  add column recipient_type text not null default 'client',
  add column recipient_phone_normalized text,
  add constraint whatsapp_messages_recipient_type_check
    check (recipient_type in ('client', 'owner')),
  add constraint whatsapp_messages_recipient_phone_check
    check (recipient_phone_normalized is null or recipient_phone_normalized ~ '^[1-9][0-9]{9,14}$');

create or replace function private.seed_tenant_operational_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pipeline_id uuid;
begin
  insert into public.tenant_notification_settings (barbershop_id)
  values (new.id)
  on conflict (barbershop_id) do nothing;

  insert into public.crm_pipelines (barbershop_id, name)
  values (new.id, 'Relacionamento')
  on conflict (barbershop_id, name) do update set name = excluded.name
  returning id into pipeline_id;

  insert into public.crm_stages (barbershop_id, pipeline_id, name, position, color)
  select new.id, pipeline_id, stage.name, stage.position, stage.color
  from (values
    ('Novo contato', 1, '#9caeff'),
    ('Agendamento pendente', 2, '#d8b7bd'),
    ('Cliente ativo', 3, '#72b88d'),
    ('Reativação', 4, '#e5a76f')
  ) as stage(name, position, color)
  on conflict (pipeline_id, name) do nothing;

  insert into public.automation_rules (
    barbershop_id, name, trigger_type, recipient_type, lead_minutes,
    channel, delay_minutes, template_body, conditions, active
  ) values
  (
    new.id, 'Lembrete do cliente — 15 min antes', 'appointment_reminder', 'client', 15,
    'whatsapp', 0,
    'Olá, {{cliente.nome}}! Seu atendimento na {{empresa.nome}} começa às {{agendamento.hora}}.',
    '{"template_key":"appointment_client_15m","meta_template_language":"pt_BR","country_code":"55"}'::jsonb,
    false
  ),
  (
    new.id, 'Lembrete do responsável — 15 min antes', 'appointment_reminder', 'owner', 15,
    'whatsapp', 0,
    '{{responsavel.nome}}, o atendimento de {{cliente.nome}} começa às {{agendamento.hora}}.',
    '{"template_key":"appointment_owner_15m","meta_template_language":"pt_BR","country_code":"55"}'::jsonb,
    false
  ),
  (
    new.id, 'Agenda pessoal do responsável', 'personal_reminder', 'owner', 0,
    'whatsapp', 0,
    '{{responsavel.nome}}, lembrete: {{lembrete.titulo}} — {{lembrete.mensagem}}',
    '{"template_key":"owner_personal_reminder","meta_template_language":"pt_BR","country_code":"55"}'::jsonb,
    false
  )
  on conflict (barbershop_id, name) do nothing;

  return new;
end;
$$;

revoke all on function private.seed_tenant_operational_defaults() from public, anon, authenticated;

create trigger barbershops_seed_operational_defaults
after insert on public.barbershops
for each row execute function private.seed_tenant_operational_defaults();

insert into public.tenant_notification_settings (barbershop_id, owner_name)
select shop.id, owner_profile.name
from public.barbershops shop
left join lateral (
  select profile.name
  from public.profiles profile
  where profile.barbershop_id = shop.id
    and profile.role = 'owner'
    and profile.active
  order by profile.created_at
  limit 1
) owner_profile on true
on conflict (barbershop_id) do nothing;

insert into public.crm_pipelines (barbershop_id, name)
select shop.id, 'Relacionamento'
from public.barbershops shop
on conflict (barbershop_id, name) do nothing;

insert into public.crm_stages (barbershop_id, pipeline_id, name, position, color)
select pipeline.barbershop_id, pipeline.id, stage.name, stage.position, stage.color
from public.crm_pipelines pipeline
cross join (values
  ('Novo contato', 1, '#9caeff'),
  ('Agendamento pendente', 2, '#d8b7bd'),
  ('Cliente ativo', 3, '#72b88d'),
  ('Reativação', 4, '#e5a76f')
) as stage(name, position, color)
where pipeline.name = 'Relacionamento'
on conflict (pipeline_id, name) do nothing;

insert into public.automation_rules (
  barbershop_id, name, trigger_type, recipient_type, lead_minutes,
  channel, delay_minutes, template_body, conditions, active
)
select shop.id, rule.name, rule.trigger_type, rule.recipient_type, rule.lead_minutes,
       'whatsapp', 0, rule.template_body, rule.conditions, false
from public.barbershops shop
cross join (values
  (
    'Lembrete do cliente — 15 min antes', 'appointment_reminder', 'client', 15,
    'Olá, {{cliente.nome}}! Seu atendimento na {{empresa.nome}} começa às {{agendamento.hora}}.',
    '{"template_key":"appointment_client_15m","meta_template_language":"pt_BR","country_code":"55"}'::jsonb
  ),
  (
    'Lembrete do responsável — 15 min antes', 'appointment_reminder', 'owner', 15,
    '{{responsavel.nome}}, o atendimento de {{cliente.nome}} começa às {{agendamento.hora}}.',
    '{"template_key":"appointment_owner_15m","meta_template_language":"pt_BR","country_code":"55"}'::jsonb
  ),
  (
    'Agenda pessoal do responsável', 'personal_reminder', 'owner', 0,
    '{{responsavel.nome}}, lembrete: {{lembrete.titulo}} — {{lembrete.mensagem}}',
    '{"template_key":"owner_personal_reminder","meta_template_language":"pt_BR","country_code":"55"}'::jsonb
  )
) as rule(name, trigger_type, recipient_type, lead_minutes, template_body, conditions)
on conflict (barbershop_id, name) do nothing;

create or replace function public.generate_due_automation_runs(
  reference_time timestamptz default now(),
  horizon_minutes integer default 2880
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_horizon integer := least(greatest(coalesce(horizon_minutes, 2880), 5), 10080);
  appointment_count integer := 0;
  personal_count integer := 0;
  reminder_record record;
  personal_rule_id uuid;
begin
  update public.automation_runs run
  set status = 'cancelled',
      finished_at = reference_time,
      error_message = 'Agendamento alterado ou cancelado antes do envio'
  from public.appointments appointment,
       public.automation_rules rule,
       public.tenant_notification_settings settings
  where run.appointment_id = appointment.id
    and run.rule_id = rule.id
    and settings.barbershop_id = appointment.barbershop_id
    and run.status = 'queued'
    and (
      appointment.status not in ('scheduled', 'confirmed')
      or run.scheduled_for <> (
        (appointment.appointment_date + appointment.start_time) at time zone settings.timezone
        - make_interval(mins => rule.lead_minutes)
      )
    );

  insert into public.automation_runs (
    barbershop_id, rule_id, client_id, recipient_type, appointment_id,
    deduplication_key, scheduled_for, payload
  )
  select
    appointment.barbershop_id,
    rule.id,
    client.id,
    rule.recipient_type,
    appointment.id,
    'appointment:' || rule.id::text || ':' || appointment.id::text || ':' ||
      extract(epoch from schedule.scheduled_for)::bigint::text,
    schedule.scheduled_for,
    jsonb_build_object(
      'source', 'appointment',
      'appointmentId', appointment.id,
      'appointmentDate', appointment.appointment_date,
      'appointmentTime', appointment.start_time,
      'clientName', client.name,
      'professionalName', professional.name,
      'businessName', shop.name,
      'recipientType', rule.recipient_type
    )
  from public.appointments appointment
  join public.clients client
    on client.barbershop_id = appointment.barbershop_id
    and client.id = appointment.client_id
  join public.professionals professional
    on professional.barbershop_id = appointment.barbershop_id
    and professional.id = appointment.professional_id
  join public.barbershops shop
    on shop.id = appointment.barbershop_id and shop.active
  join public.tenant_notification_settings settings
    on settings.barbershop_id = appointment.barbershop_id
  join public.automation_rules rule
    on rule.barbershop_id = appointment.barbershop_id
    and rule.trigger_type = 'appointment_reminder'
    and rule.channel = 'whatsapp'
    and rule.active
  cross join lateral (
    select (
      (appointment.appointment_date + appointment.start_time) at time zone settings.timezone
      - make_interval(mins => rule.lead_minutes)
    ) as scheduled_for
  ) schedule
  where appointment.status in ('scheduled', 'confirmed')
    and schedule.scheduled_for >= reference_time - interval '5 minutes'
    and schedule.scheduled_for <= reference_time + make_interval(mins => safe_horizon)
    and (
      (rule.recipient_type = 'client'
        and client.whatsapp_opt_in
        and private.normalize_whatsapp_number(client.phone_normalized, settings.default_country_code) is not null)
      or
      (rule.recipient_type = 'owner'
        and settings.owner_whatsapp_opt_in
        and settings.owner_phone_normalized is not null)
    )
  on conflict (barbershop_id, deduplication_key) do nothing;

  get diagnostics appointment_count = row_count;

  for reminder_record in
    select reminder.*
    from public.personal_reminders reminder
    join public.tenant_notification_settings settings
      on settings.barbershop_id = reminder.barbershop_id
      and settings.owner_whatsapp_opt_in
      and settings.owner_phone_normalized is not null
    join public.barbershops shop
      on shop.id = reminder.barbershop_id and shop.active
    where reminder.active
      and reminder.next_run_at >= reference_time - interval '5 minutes'
      and reminder.next_run_at <= reference_time + make_interval(mins => safe_horizon)
    order by reminder.next_run_at
    for update of reminder skip locked
  loop
    select rule.id into personal_rule_id
    from public.automation_rules rule
    where rule.barbershop_id = reminder_record.barbershop_id
      and rule.trigger_type = 'personal_reminder'
      and rule.recipient_type = 'owner'
      and rule.channel = 'whatsapp'
      and rule.active
    order by rule.created_at
    limit 1;

    if personal_rule_id is not null then
      insert into public.automation_runs (
        barbershop_id, rule_id, recipient_type, personal_reminder_id,
        deduplication_key, scheduled_for, payload
      ) values (
        reminder_record.barbershop_id,
        personal_rule_id,
        'owner',
        reminder_record.id,
        'personal:' || personal_rule_id::text || ':' || reminder_record.id::text || ':' ||
          extract(epoch from reminder_record.next_run_at)::bigint::text,
        reminder_record.next_run_at,
        jsonb_build_object(
          'source', 'personal_reminder',
          'personalReminderId', reminder_record.id,
          'reminderTitle', reminder_record.title,
          'reminderBody', reminder_record.message_body,
          'recipientType', 'owner'
        )
      )
      on conflict (barbershop_id, deduplication_key) do nothing;

      if found then
        personal_count := personal_count + 1;
        update public.personal_reminders
        set active = reminder_record.repeat_every_days is not null,
            next_run_at = case
              when reminder_record.repeat_every_days is null then reminder_record.next_run_at
              else reminder_record.next_run_at + make_interval(days => reminder_record.repeat_every_days)
            end,
            updated_at = reference_time
        where id = reminder_record.id;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'appointmentRunsCreated', appointment_count,
    'personalRunsCreated', personal_count,
    'generatedAt', reference_time,
    'horizonMinutes', safe_horizon
  );
end;
$$;

comment on function public.generate_due_automation_runs(timestamptz, integer) is
  'Gera de forma idempotente lembretes Meta para clientes, responsável e agenda pessoal. Deve ser chamado pelo worker antes de reservar a fila.';

revoke all on function public.generate_due_automation_runs(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.generate_due_automation_runs(timestamptz, integer) to service_role;

create or replace function public.claim_automation_runs(
  requested_worker_id text,
  requested_batch_size integer default 10,
  requested_lease_seconds integer default 300
)
returns table(item jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_batch_size integer := least(greatest(coalesce(requested_batch_size, 10), 1), 50);
  safe_lease_seconds integer := least(greatest(coalesce(requested_lease_seconds, 300), 60), 1800);
begin
  if nullif(btrim(requested_worker_id), '') is null or length(requested_worker_id) > 100 then
    raise exception 'Identificador do worker inválido' using errcode = '22023';
  end if;

  update public.automation_runs run
  set status = 'failed', finished_at = now(),
      error_message = 'Limite de tentativas excedido após expiração do processamento',
      lease_expires_at = null
  where run.status = 'processing' and run.lease_expires_at < now() and run.attempt_count >= 3;

  update public.automation_runs run
  set status = 'queued', started_at = null, worker_id = null, lease_token = null,
      lease_expires_at = null,
      error_message = 'Processamento expirado; execução recolocada na fila'
  where run.status = 'processing' and run.lease_expires_at < now() and run.attempt_count < 3;

  return query
  with candidates as materialized (
    select run.id
    from public.automation_runs run
    join public.automation_rules rule on rule.id = run.rule_id
    join public.barbershops shop on shop.id = run.barbershop_id
    left join public.clients client
      on client.barbershop_id = run.barbershop_id and client.id = run.client_id
    left join public.tenant_notification_settings settings
      on settings.barbershop_id = run.barbershop_id
    where run.status = 'queued'
      and run.scheduled_for <= now()
      and run.attempt_count < 3
      and rule.active
      and shop.active
      and exists (
        select 1 from public.subscriptions subscription
        where subscription.barbershop_id = run.barbershop_id
          and (
            subscription.status = 'active'
            or (subscription.status = 'trial' and (subscription.trial_ends_at is null or subscription.trial_ends_at > now()))
          )
      )
      and (
        rule.channel <> 'whatsapp'
        or (
          exists (
            select 1 from public.whatsapp_connections connection
            where connection.barbershop_id = run.barbershop_id and connection.status = 'connected'
          )
          and (
            (run.recipient_type = 'client'
              and client.id is not null
              and client.whatsapp_opt_in
              and private.normalize_whatsapp_number(client.phone_normalized, coalesce(settings.default_country_code, '55')) is not null)
            or
            (run.recipient_type = 'owner'
              and settings.owner_whatsapp_opt_in
              and settings.owner_phone_normalized is not null)
          )
        )
      )
    order by run.scheduled_for, run.created_at
    for update of run skip locked
    limit safe_batch_size
  ), claimed as (
    update public.automation_runs run
    set status = 'processing', started_at = now(), finished_at = null, error_message = null,
        attempt_count = run.attempt_count + 1, worker_id = btrim(requested_worker_id),
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => safe_lease_seconds)
    from candidates
    where run.id = candidates.id
    returning run.*
  )
  select jsonb_build_object(
    'id', claimed.id,
    'leaseToken', claimed.lease_token,
    'scheduledFor', claimed.scheduled_for,
    'attempt', claimed.attempt_count,
    'leaseExpiresAt', claimed.lease_expires_at,
    'tenant', jsonb_build_object('id', shop.id, 'slug', shop.slug, 'name', shop.name),
    'rule', jsonb_build_object(
      'id', rule.id, 'name', rule.name, 'trigger', rule.trigger_type,
      'channel', rule.channel, 'templateBody', rule.template_body, 'conditions', rule.conditions
    ),
    'recipient', case
      when claimed.recipient_type = 'owner' then jsonb_build_object(
        'type', 'owner', 'name', settings.owner_name,
        'phone', settings.owner_phone_normalized, 'whatsappOptIn', settings.owner_whatsapp_opt_in
      )
      else jsonb_build_object(
        'type', 'client', 'name', client.name,
        'phone', private.normalize_whatsapp_number(client.phone_normalized, coalesce(settings.default_country_code, '55')),
        'whatsappOptIn', client.whatsapp_opt_in
      )
    end,
    'client', case when client.id is null then null else jsonb_build_object(
      'id', client.id, 'name', client.name, 'phone', client.phone_normalized,
      'whatsappOptIn', client.whatsapp_opt_in
    ) end,
    'payload', claimed.payload
  ) as item
  from claimed
  join public.barbershops shop on shop.id = claimed.barbershop_id
  join public.automation_rules rule on rule.id = claimed.rule_id
  left join public.clients client
    on client.barbershop_id = claimed.barbershop_id and client.id = claimed.client_id
  left join public.tenant_notification_settings settings
    on settings.barbershop_id = claimed.barbershop_id
  order by claimed.scheduled_for, claimed.created_at;
end;
$$;

create or replace function public.finish_automation_run(
  target_run_id uuid,
  claimed_lease_token uuid,
  outcome text,
  provider_message_id text default null,
  failure_message text default null,
  message_preview text default null,
  retry_after_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.automation_runs;
  target_channel text;
  target_phone text;
  default_country text;
  final_status text;
  safe_retry_seconds integer := least(greatest(coalesce(retry_after_seconds, 300), 60), 3600);
begin
  if outcome not in ('sent', 'failed', 'retry') then
    raise exception 'Resultado de automação inválido' using errcode = '22023';
  end if;

  select run.* into target from public.automation_runs run where run.id = target_run_id for update;
  if target.id is null then raise exception 'Execução de automação não encontrada' using errcode = 'P0002'; end if;
  if target.lease_token is distinct from claimed_lease_token then
    raise exception 'Lease inválido ou substituído por outro processamento' using errcode = '42501';
  end if;
  if target.status in ('sent', 'failed') then
    return jsonb_build_object('id', target.id, 'status', target.status, 'alreadyCompleted', true);
  end if;
  if target.status <> 'processing' or target.lease_expires_at < now() then
    raise exception 'Execução não está em processamento ou o lease expirou' using errcode = '55000';
  end if;

  if outcome = 'retry' and target.attempt_count < 3 then
    update public.automation_runs
    set status = 'queued', scheduled_for = now() + make_interval(secs => safe_retry_seconds),
        started_at = null, worker_id = null, lease_token = null, lease_expires_at = null,
        error_message = left(coalesce(failure_message, 'Nova tentativa solicitada pelo worker'), 1000)
    where id = target.id;
    return jsonb_build_object(
      'id', target.id, 'status', 'queued',
      'retryAt', now() + make_interval(secs => safe_retry_seconds), 'alreadyCompleted', false
    );
  end if;

  final_status := case when outcome = 'sent' then 'sent' else 'failed' end;
  update public.automation_runs
  set status = final_status, finished_at = now(), lease_expires_at = null,
      error_message = case when final_status = 'failed'
        then left(coalesce(failure_message, 'Falha informada pelo worker'), 1000) else null end
  where id = target.id;

  select rule.channel into target_channel from public.automation_rules rule where rule.id = target.rule_id;
  select settings.default_country_code into default_country
  from public.tenant_notification_settings settings where settings.barbershop_id = target.barbershop_id;

  if target.recipient_type = 'owner' then
    select settings.owner_phone_normalized into target_phone
    from public.tenant_notification_settings settings where settings.barbershop_id = target.barbershop_id;
  else
    select private.normalize_whatsapp_number(client.phone_normalized, coalesce(default_country, '55')) into target_phone
    from public.clients client
    where client.barbershop_id = target.barbershop_id and client.id = target.client_id;
  end if;

  if final_status = 'sent' and target_channel = 'whatsapp' then
    insert into public.whatsapp_messages (
      barbershop_id, client_id, automation_run_id, provider_message_id,
      direction, body_preview, status, sent_at, recipient_type, recipient_phone_normalized
    ) values (
      target.barbershop_id,
      case when target.recipient_type = 'client' then target.client_id else null end,
      target.id, nullif(left(provider_message_id, 255), ''), 'outbound',
      nullif(left(message_preview, 500), ''), 'sent', now(), target.recipient_type, target_phone
    )
    on conflict (barbershop_id, automation_run_id)
      where direction = 'outbound' and automation_run_id is not null
    do update set provider_message_id = excluded.provider_message_id,
      body_preview = excluded.body_preview, status = 'sent', sent_at = excluded.sent_at,
      recipient_type = excluded.recipient_type,
      recipient_phone_normalized = excluded.recipient_phone_normalized;
  end if;

  return jsonb_build_object('id', target.id, 'status', final_status, 'alreadyCompleted', false);
end;
$$;

create or replace function public.get_whatsapp_delivery_context(
  target_run_id uuid,
  claimed_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  context jsonb;
begin
  select jsonb_build_object(
    'runId', run.id,
    'barbershopId', run.barbershop_id,
    'clientId', client.id,
    'recipientType', run.recipient_type,
    'recipientName', case when run.recipient_type = 'owner' then settings.owner_name else client.name end,
    'recipient', case
      when run.recipient_type = 'owner' then settings.owner_phone_normalized
      else private.normalize_whatsapp_number(client.phone_normalized, settings.default_country_code)
    end,
    'phoneNumberId', connection.phone_number_id,
    'graphApiVersion', connection.graph_api_version,
    'accessToken', secret.decrypted_secret,
    'templateName', nullif(rule.conditions ->> 'meta_template_name', ''),
    'templateLanguage', coalesce(nullif(rule.conditions ->> 'meta_template_language', ''), 'pt_BR'),
    'messagePreview', rule.template_body,
    'payload', run.payload
  ) into context
  from public.automation_runs run
  join public.automation_rules rule on rule.id = run.rule_id
  join public.barbershops shop on shop.id = run.barbershop_id and shop.active
  left join public.clients client
    on client.barbershop_id = run.barbershop_id and client.id = run.client_id
  join public.tenant_notification_settings settings
    on settings.barbershop_id = run.barbershop_id
  join public.whatsapp_connections connection
    on connection.barbershop_id = run.barbershop_id and connection.status = 'connected'
  join vault.decrypted_secrets secret on secret.id::text = connection.secret_reference
  where run.id = target_run_id
    and run.status = 'processing'
    and run.lease_token = claimed_lease_token
    and run.lease_expires_at >= now()
    and rule.active
    and rule.channel = 'whatsapp'
    and nullif(rule.conditions ->> 'meta_template_name', '') is not null
    and (
      (run.recipient_type = 'client'
        and client.id is not null
        and client.whatsapp_opt_in
        and private.normalize_whatsapp_number(client.phone_normalized, settings.default_country_code) is not null)
      or
      (run.recipient_type = 'owner'
        and settings.owner_whatsapp_opt_in
        and settings.owner_phone_normalized is not null)
    )
    and exists (
      select 1 from public.subscriptions subscription
      where subscription.barbershop_id = run.barbershop_id
        and (
          subscription.status = 'active'
          or (subscription.status = 'trial' and (subscription.trial_ends_at is null or subscription.trial_ends_at > now()))
        )
    );

  if context is null then
    raise exception 'Execução não está pronta para envio pelo WhatsApp' using errcode = '55000';
  end if;
  return context;
end;
$$;

comment on table public.tenant_notification_settings is
  'Destinatário responsável e preferências regionais usadas pelas automações Meta de cada tenant.';
comment on table public.personal_reminders is
  'Agenda pessoal recorrente ou pontual do responsável, convertida em execuções idempotentes.';
comment on function public.claim_automation_runs(text, integer, integer) is
  'Reserva execuções Meta prontas para cliente ou responsável, com lease e SKIP LOCKED.';
comment on function public.get_whatsapp_delivery_context(uuid, uuid) is
  'Entrega ao serviço Meta o destinatário elegível, template aprovado, payload e token do Vault.';

revoke all on function public.claim_automation_runs(text, integer, integer) from public, anon, authenticated;
revoke all on function public.finish_automation_run(uuid, uuid, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.get_whatsapp_delivery_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_automation_runs(text, integer, integer) to service_role;
grant execute on function public.finish_automation_run(uuid, uuid, text, text, text, text, integer) to service_role;
grant execute on function public.get_whatsapp_delivery_context(uuid, uuid) to service_role;

;
