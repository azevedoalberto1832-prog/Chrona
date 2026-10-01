create or replace function private.is_platform_admin_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = target_profile_id
      and profile.auth_user_id = (select auth.uid())
      and profile.role = 'platform_admin'
      and profile.active
  );
$$;

revoke all on function private.is_platform_admin_profile(uuid) from public, anon;
grant execute on function private.is_platform_admin_profile(uuid) to authenticated;

create table public.platform_notification_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  admin_name text,
  admin_phone text,
  admin_phone_normalized text,
  whatsapp_opt_in boolean not null default false,
  whatsapp_opt_in_at timestamptz,
  default_country_code text not null default '55',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_notification_admin_name_valid
    check (admin_name is null or length(btrim(admin_name)) between 2 and 120),
  constraint platform_notification_country_code_valid
    check (default_country_code ~ '^[1-9][0-9]{0,2}$'),
  constraint platform_notification_phone_valid
    check (admin_phone_normalized is null or admin_phone_normalized ~ '^[1-9][0-9]{9,14}$'),
  constraint platform_notification_opt_in_valid
    check (not whatsapp_opt_in or admin_phone_normalized is not null)
);

create or replace function private.sync_platform_notification_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles profile
    where profile.id = new.profile_id and profile.role = 'platform_admin' and profile.active
  ) then
    raise exception 'O destinatário precisa ser um administrador ativo da Chrona' using errcode = '22023';
  end if;
  new.admin_name := nullif(btrim(new.admin_name), '');
  new.admin_phone := nullif(btrim(new.admin_phone), '');
  new.admin_phone_normalized := private.normalize_whatsapp_number(new.admin_phone, new.default_country_code);
  if new.admin_phone is not null and new.admin_phone_normalized is null then
    raise exception 'Informe o WhatsApp do administrador com DDD' using errcode = '22023';
  end if;
  if new.whatsapp_opt_in and new.whatsapp_opt_in_at is null then
    new.whatsapp_opt_in_at := now();
  elsif not new.whatsapp_opt_in then
    new.whatsapp_opt_in_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.sync_platform_notification_settings() from public, anon, authenticated;

create trigger platform_notification_settings_sync
before insert or update on public.platform_notification_settings
for each row execute function private.sync_platform_notification_settings();

alter table public.platform_notification_settings enable row level security;

create policy platform_notification_settings_admin_select
on public.platform_notification_settings for select to authenticated
using ((select private.is_platform_admin_profile(profile_id)));

create policy platform_notification_settings_admin_insert
on public.platform_notification_settings for insert to authenticated
with check ((select private.is_platform_admin_profile(profile_id)));

create policy platform_notification_settings_admin_update
on public.platform_notification_settings for update to authenticated
using ((select private.is_platform_admin_profile(profile_id)))
with check ((select private.is_platform_admin_profile(profile_id)));

grant select, insert, update on public.platform_notification_settings to authenticated;

insert into public.platform_notification_settings (profile_id, admin_name)
select profile.id, profile.name
from public.profiles profile
where profile.role = 'platform_admin' and profile.active
on conflict (profile_id) do nothing;

create or replace function private.seed_platform_notification_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'platform_admin' and new.active then
    insert into public.platform_notification_settings (profile_id, admin_name)
    values (new.id, new.name)
    on conflict (profile_id) do update set admin_name = excluded.admin_name;
  end if;
  return new;
end;
$$;

revoke all on function private.seed_platform_notification_settings() from public, anon, authenticated;

create trigger profiles_seed_platform_notification_settings
after insert or update of name, role, active on public.profiles
for each row execute function private.seed_platform_notification_settings();

alter table public.automation_rules
  drop constraint automation_rules_trigger_type_check,
  drop constraint automation_rules_recipient_type_check,
  add constraint automation_rules_trigger_type_check check (
    trigger_type in (
      'birthday', 'return_due', 'appointment_created', 'appointment_reminder',
      'appointment_completed', 'crm_stage_changed', 'personal_reminder',
      'subscription_expiring'
    )
  ),
  add constraint automation_rules_recipient_type_check
    check (recipient_type in ('client', 'owner', 'platform_admin'));

alter table public.automation_runs
  drop constraint automation_runs_recipient_type_check,
  add column client_reminder_id uuid references public.reminders(id) on delete cascade,
  add column subscription_id uuid references public.subscriptions(id) on delete cascade,
  add column platform_profile_id uuid references public.profiles(id) on delete cascade,
  add constraint automation_runs_recipient_type_check
    check (recipient_type in ('client', 'owner', 'platform_admin'));

alter table public.whatsapp_messages
  drop constraint whatsapp_messages_recipient_type_check,
  add constraint whatsapp_messages_recipient_type_check
    check (recipient_type in ('client', 'owner', 'platform_admin'));

create index automation_runs_client_reminder_idx
  on public.automation_runs (client_reminder_id)
  where client_reminder_id is not null;

create index automation_runs_subscription_idx
  on public.automation_runs (subscription_id)
  where subscription_id is not null;

create index automation_runs_platform_profile_idx
  on public.automation_runs (platform_profile_id)
  where platform_profile_id is not null;

alter table public.services alter column return_interval_days set default 20;

update public.services
set return_interval_days = 20, updated_at = now()
where return_interval_days = 30;

create or replace function private.anniversary_date(source_date date, target_year integer)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  return make_date(target_year, extract(month from source_date)::integer, extract(day from source_date)::integer);
exception when datetime_field_overflow then
  return make_date(target_year, 2, 28);
end;
$$;

revoke all on function private.anniversary_date(date, integer) from public, anon, authenticated;

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
  )
  select new.id, rule.name, rule.trigger_type, rule.recipient_type, rule.lead_minutes,
         'whatsapp', rule.delay_minutes, rule.template_body, rule.conditions, false
  from (values
    (
      'Agendamento confirmado', 'appointment_created', 'client', 0, 0,
      'Olá, {{cliente.nome}}! Seu horário na {{empresa.nome}} foi marcado para {{agendamento.data}} às {{agendamento.hora}}.',
      '{"template_key":"appointment_created_client","meta_template_language":"pt_BR","country_code":"55"}'::jsonb
    ),
    (
      'Lembrete do cliente — 15 min antes', 'appointment_reminder', 'client', 15, 0,
      'Olá, {{cliente.nome}}! Seu atendimento na {{empresa.nome}} começa às {{agendamento.hora}}.',
      '{"template_key":"appointment_client_15m","meta_template_language":"pt_BR","country_code":"55"}'::jsonb
    ),
    (
      'Lembrete do responsável — 15 min antes', 'appointment_reminder', 'owner', 15, 0,
      '{{responsavel.nome}}, o atendimento de {{cliente.nome}} começa às {{agendamento.hora}}.',
      '{"template_key":"appointment_owner_15m","meta_template_language":"pt_BR","country_code":"55"}'::jsonb
    ),
    (
      'Aniversário', 'birthday', 'client', 0, 540,
      'Feliz aniversário, {{cliente.nome}}! A {{empresa.nome}} deseja um dia especial para você.',
      '{"template_key":"client_birthday","meta_template_language":"pt_BR","country_code":"55"}'::jsonb
    ),
    (
      'Retorno de cliente', 'return_due', 'client', 0, 540,
      'Olá, {{cliente.nome}}! Já se passaram 20 dias desde seu atendimento na {{empresa.nome}}. Que tal reservar o próximo horário?',
      '{"template_key":"client_return_20d","meta_template_language":"pt_BR","country_code":"55","return_days":20}'::jsonb
    ),
    (
      'Agenda pessoal do responsável', 'personal_reminder', 'owner', 0, 0,
      '{{responsavel.nome}}, lembrete: {{lembrete.titulo}} — {{lembrete.mensagem}}',
      '{"template_key":"owner_personal_reminder","meta_template_language":"pt_BR","country_code":"55"}'::jsonb
    ),
    (
      'Plano próximo do vencimento', 'subscription_expiring', 'platform_admin', 0, 0,
      'Chrona: o plano {{plano.nome}} da empresa {{empresa.nome}} vence em {{plano.dias}} dia(s), em {{plano.vencimento}}.',
      '{"template_key":"platform_subscription_expiring","meta_template_language":"pt_BR","country_code":"55","days_before":[7,3,1,0]}'::jsonb
    )
  ) as rule(name, trigger_type, recipient_type, lead_minutes, delay_minutes, template_body, conditions)
  on conflict (barbershop_id, name) do nothing;

  return new;
end;
$$;

revoke all on function private.seed_tenant_operational_defaults() from public, anon, authenticated;

insert into public.automation_rules (
  barbershop_id, name, trigger_type, recipient_type, lead_minutes,
  channel, delay_minutes, template_body, conditions, active
)
select shop.id, rule.name, rule.trigger_type, rule.recipient_type, rule.lead_minutes,
       'whatsapp', rule.delay_minutes, rule.template_body, rule.conditions, false
from public.barbershops shop
cross join (values
  (
    'Agendamento confirmado', 'appointment_created', 'client', 0, 0,
    'Olá, {{cliente.nome}}! Seu horário na {{empresa.nome}} foi marcado para {{agendamento.data}} às {{agendamento.hora}}.',
    '{"template_key":"appointment_created_client","meta_template_language":"pt_BR","country_code":"55"}'::jsonb
  ),
  (
    'Lembrete do cliente — 15 min antes', 'appointment_reminder', 'client', 15, 0,
    'Olá, {{cliente.nome}}! Seu atendimento na {{empresa.nome}} começa às {{agendamento.hora}}.',
    '{"template_key":"appointment_client_15m","meta_template_language":"pt_BR","country_code":"55"}'::jsonb
  ),
  (
    'Lembrete do responsável — 15 min antes', 'appointment_reminder', 'owner', 15, 0,
    '{{responsavel.nome}}, o atendimento de {{cliente.nome}} começa às {{agendamento.hora}}.',
    '{"template_key":"appointment_owner_15m","meta_template_language":"pt_BR","country_code":"55"}'::jsonb
  ),
  (
    'Aniversário', 'birthday', 'client', 0, 540,
    'Feliz aniversário, {{cliente.nome}}! A {{empresa.nome}} deseja um dia especial para você.',
    '{"template_key":"client_birthday","meta_template_language":"pt_BR","country_code":"55"}'::jsonb
  ),
  (
    'Retorno de cliente', 'return_due', 'client', 0, 540,
    'Olá, {{cliente.nome}}! Já se passaram 20 dias desde seu atendimento na {{empresa.nome}}. Que tal reservar o próximo horário?',
    '{"template_key":"client_return_20d","meta_template_language":"pt_BR","country_code":"55","return_days":20}'::jsonb
  ),
  (
    'Agenda pessoal do responsável', 'personal_reminder', 'owner', 0, 0,
    '{{responsavel.nome}}, lembrete: {{lembrete.titulo}} — {{lembrete.mensagem}}',
    '{"template_key":"owner_personal_reminder","meta_template_language":"pt_BR","country_code":"55"}'::jsonb
  ),
  (
    'Plano próximo do vencimento', 'subscription_expiring', 'platform_admin', 0, 0,
    'Chrona: o plano {{plano.nome}} da empresa {{empresa.nome}} vence em {{plano.dias}} dia(s), em {{plano.vencimento}}.',
    '{"template_key":"platform_subscription_expiring","meta_template_language":"pt_BR","country_code":"55","days_before":[7,3,1,0]}'::jsonb
  )
) as rule(name, trigger_type, recipient_type, lead_minutes, delay_minutes, template_body, conditions)
on conflict (barbershop_id, name) do update set
  trigger_type = excluded.trigger_type,
  recipient_type = excluded.recipient_type,
  lead_minutes = excluded.lead_minutes,
  channel = excluded.channel,
  delay_minutes = excluded.delay_minutes,
  template_body = excluded.template_body,
  conditions = excluded.conditions,
  updated_at = now();

create or replace function public.generate_universal_event_runs(
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
  confirmation_count integer := 0;
  birthday_count integer := 0;
  return_count integer := 0;
  subscription_count integer := 0;
begin
  insert into public.automation_runs (
    barbershop_id, rule_id, client_id, recipient_type,
    deduplication_key, scheduled_for, payload
  )
  select
    appointment.barbershop_id, rule.id, client.id, 'client',
    'appointment-created:' || rule.id::text || ':' || appointment.id::text,
    appointment.created_at + make_interval(mins => rule.delay_minutes),
    jsonb_build_object(
      'source', 'appointment_created', 'appointmentId', appointment.id,
      'appointmentDate', appointment.appointment_date, 'appointmentTime', appointment.start_time,
      'clientName', client.name, 'professionalName', professional.name,
      'businessName', shop.name, 'recipientType', 'client'
    )
  from public.appointments appointment
  join public.clients client on client.barbershop_id=appointment.barbershop_id and client.id=appointment.client_id
  join public.professionals professional on professional.barbershop_id=appointment.barbershop_id and professional.id=appointment.professional_id
  join public.barbershops shop on shop.id=appointment.barbershop_id and shop.active
  join public.tenant_notification_settings settings on settings.barbershop_id=appointment.barbershop_id
  join public.automation_rules rule on rule.barbershop_id=appointment.barbershop_id
    and rule.trigger_type='appointment_created' and rule.recipient_type='client'
    and rule.channel='whatsapp' and rule.active
  where appointment.status in ('scheduled','confirmed')
    and client.whatsapp_opt_in
    and private.normalize_whatsapp_number(client.phone_normalized,settings.default_country_code) is not null
    and appointment.created_at + make_interval(mins => rule.delay_minutes) >= reference_time - interval '1 day'
    and appointment.created_at + make_interval(mins => rule.delay_minutes) <= reference_time + make_interval(mins => safe_horizon)
  on conflict (barbershop_id,deduplication_key) do nothing;
  get diagnostics confirmation_count = row_count;

  insert into public.automation_runs (
    barbershop_id, rule_id, client_id, recipient_type,
    deduplication_key, scheduled_for, payload
  )
  select
    client.barbershop_id, rule.id, client.id, 'client',
    'birthday:' || rule.id::text || ':' || client.id::text || ':' || extract(year from birthday_date.target_date)::integer::text,
    birthday_schedule.scheduled_for,
    jsonb_build_object(
      'source','birthday','clientName',client.name,'businessName',shop.name,
      'birthdayDate',birthday_date.target_date,'recipientType','client'
    )
  from public.clients client
  join public.barbershops shop on shop.id=client.barbershop_id and shop.active
  join public.tenant_notification_settings settings on settings.barbershop_id=client.barbershop_id
  join public.automation_rules rule on rule.barbershop_id=client.barbershop_id
    and rule.trigger_type='birthday' and rule.recipient_type='client'
    and rule.channel='whatsapp' and rule.active
  cross join lateral (
    select (reference_time at time zone settings.timezone)::date as local_today
  ) local_reference
  cross join lateral (
    select private.anniversary_date(client.birth_date,extract(year from local_reference.local_today)::integer) as this_year
  ) birthday_this_year
  cross join lateral (
    select case when birthday_this_year.this_year < local_reference.local_today
      then private.anniversary_date(client.birth_date,extract(year from local_reference.local_today)::integer+1)
      else birthday_this_year.this_year end as target_date
  ) birthday_date
  cross join lateral (
    select ((birthday_date.target_date + make_interval(mins=>rule.delay_minutes)) at time zone settings.timezone) as scheduled_for
  ) birthday_schedule
  where client.birth_date is not null and client.whatsapp_opt_in
    and private.normalize_whatsapp_number(client.phone_normalized,settings.default_country_code) is not null
    and birthday_schedule.scheduled_for >= reference_time - interval '1 day'
    and birthday_schedule.scheduled_for <= reference_time + make_interval(mins=>safe_horizon)
  on conflict (barbershop_id,deduplication_key) do nothing;
  get diagnostics birthday_count = row_count;

  insert into public.automation_runs (
    barbershop_id, rule_id, client_id, recipient_type, client_reminder_id,
    deduplication_key, scheduled_for, payload
  )
  select
    reminder.barbershop_id, rule.id, client.id, 'client', reminder.id,
    'return:' || rule.id::text || ':' || reminder.id::text,
    return_schedule.scheduled_for,
    jsonb_build_object(
      'source','return_due','clientReminderId',reminder.id,
      'returnDate',reminder.scheduled_for,'clientName',client.name,
      'businessName',shop.name,'recipientType','client'
    )
  from public.reminders reminder
  join public.clients client on client.barbershop_id=reminder.barbershop_id and client.id=reminder.client_id
  join public.barbershops shop on shop.id=reminder.barbershop_id and shop.active
  join public.tenant_notification_settings settings on settings.barbershop_id=reminder.barbershop_id
  join public.automation_rules rule on rule.barbershop_id=reminder.barbershop_id
    and rule.trigger_type='return_due' and rule.recipient_type='client'
    and rule.channel='whatsapp' and rule.active
  cross join lateral (
    select ((reminder.scheduled_for + make_interval(mins=>rule.delay_minutes)) at time zone settings.timezone) as scheduled_for
  ) return_schedule
  where reminder.type='return' and reminder.status='pending' and client.whatsapp_opt_in
    and private.normalize_whatsapp_number(client.phone_normalized,settings.default_country_code) is not null
    and return_schedule.scheduled_for >= reference_time - interval '1 day'
    and return_schedule.scheduled_for <= reference_time + make_interval(mins=>safe_horizon)
  on conflict (barbershop_id,deduplication_key) do nothing;
  get diagnostics return_count = row_count;

  insert into public.automation_runs (
    barbershop_id, rule_id, recipient_type, subscription_id, platform_profile_id,
    deduplication_key, scheduled_for, payload
  )
  select
    subscription.barbershop_id, rule.id, 'platform_admin', subscription.id, platform_settings.profile_id,
    'subscription:' || rule.id::text || ':' || subscription.id::text || ':' || platform_settings.profile_id::text || ':' || threshold.days_before::text,
    expiry.expires_at - make_interval(days=>threshold.days_before),
    jsonb_build_object(
      'source','subscription_expiring','subscriptionId',subscription.id,
      'planName',subscription.plan,'daysBefore',threshold.days_before,
      'expiresAt',expiry.expires_at,'businessName',shop.name,
      'businessSlug',shop.slug,'recipientType','platform_admin'
    )
  from public.subscriptions subscription
  join public.barbershops shop on shop.id=subscription.barbershop_id and shop.active
  join public.automation_rules rule on rule.barbershop_id=subscription.barbershop_id
    and rule.trigger_type='subscription_expiring' and rule.recipient_type='platform_admin'
    and rule.channel='whatsapp' and rule.active
  join public.platform_notification_settings platform_settings
    on platform_settings.whatsapp_opt_in and platform_settings.admin_phone_normalized is not null
  cross join lateral (
    select coalesce(subscription.current_period_end,subscription.trial_ends_at) as expires_at
  ) expiry
  cross join (values(7),(3),(1),(0)) as threshold(days_before)
  where subscription.status in ('trial','active','overdue') and expiry.expires_at is not null
    and expiry.expires_at - make_interval(days=>threshold.days_before) >= reference_time - interval '1 day'
    and expiry.expires_at - make_interval(days=>threshold.days_before) <= reference_time + make_interval(mins=>safe_horizon)
  on conflict (barbershop_id,deduplication_key) do nothing;
  get diagnostics subscription_count = row_count;

  return jsonb_build_object(
    'appointmentConfirmationsCreated',confirmation_count,
    'birthdayRunsCreated',birthday_count,
    'returnRunsCreated',return_count,
    'subscriptionRunsCreated',subscription_count,
    'generatedAt',reference_time,'horizonMinutes',safe_horizon
  );
end;
$$;

create or replace function public.generate_all_automation_runs(
  reference_time timestamptz default now(),
  horizon_minutes integer default 2880
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  scheduled jsonb;
  universal jsonb;
begin
  scheduled := public.generate_due_automation_runs(reference_time,horizon_minutes);
  universal := public.generate_universal_event_runs(reference_time,horizon_minutes);
  return jsonb_build_object('scheduled',scheduled,'universal',universal);
end;
$$;

comment on function public.generate_all_automation_runs(timestamptz,integer) is
  'Gera a matriz universal de eventos Meta: confirmação, 15 minutos, aniversário, retorno, agenda pessoal e vencimento de plano.';

revoke all on function public.generate_universal_event_runs(timestamptz,integer) from public,anon,authenticated;
revoke all on function public.generate_all_automation_runs(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.generate_universal_event_runs(timestamptz,integer) to service_role;
grant execute on function public.generate_all_automation_runs(timestamptz,integer) to service_role;

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
  safe_batch_size integer := least(greatest(coalesce(requested_batch_size,10),1),50);
  safe_lease_seconds integer := least(greatest(coalesce(requested_lease_seconds,300),60),1800);
begin
  if nullif(btrim(requested_worker_id),'') is null or length(requested_worker_id)>100 then
    raise exception 'Identificador do worker inválido' using errcode='22023';
  end if;

  update public.automation_runs run
  set status='failed',finished_at=now(),
      error_message='Limite de tentativas excedido após expiração do processamento',lease_expires_at=null
  where run.status='processing' and run.lease_expires_at<now() and run.attempt_count>=3;

  update public.automation_runs run
  set status='queued',started_at=null,worker_id=null,lease_token=null,lease_expires_at=null,
      error_message='Processamento expirado; execução recolocada na fila'
  where run.status='processing' and run.lease_expires_at<now() and run.attempt_count<3;

  return query
  with candidates as materialized (
    select run.id
    from public.automation_runs run
    join public.automation_rules rule on rule.id=run.rule_id
    join public.barbershops shop on shop.id=run.barbershop_id
    left join public.clients client on client.barbershop_id=run.barbershop_id and client.id=run.client_id
    left join public.tenant_notification_settings settings on settings.barbershop_id=run.barbershop_id
    left join public.platform_notification_settings platform_settings on platform_settings.profile_id=run.platform_profile_id
    where run.status='queued' and run.scheduled_for<=now() and run.attempt_count<3
      and rule.active and shop.active
      and (
        rule.trigger_type='subscription_expiring'
        or exists (
          select 1 from public.subscriptions subscription
          where subscription.barbershop_id=run.barbershop_id
            and (subscription.status='active' or (subscription.status='trial' and (subscription.trial_ends_at is null or subscription.trial_ends_at>now())))
        )
      )
      and (
        rule.channel<>'whatsapp'
        or (
          exists (select 1 from public.whatsapp_connections connection where connection.barbershop_id=run.barbershop_id and connection.status='connected')
          and (
            (run.recipient_type='client' and client.id is not null and client.whatsapp_opt_in
              and private.normalize_whatsapp_number(client.phone_normalized,coalesce(settings.default_country_code,'55')) is not null)
            or (run.recipient_type='owner' and settings.owner_whatsapp_opt_in and settings.owner_phone_normalized is not null)
            or (run.recipient_type='platform_admin' and platform_settings.whatsapp_opt_in and platform_settings.admin_phone_normalized is not null)
          )
        )
      )
    order by run.scheduled_for,run.created_at
    for update of run skip locked limit safe_batch_size
  ), claimed as (
    update public.automation_runs run
    set status='processing',started_at=now(),finished_at=null,error_message=null,
        attempt_count=run.attempt_count+1,worker_id=btrim(requested_worker_id),
        lease_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>safe_lease_seconds)
    from candidates where run.id=candidates.id returning run.*
  )
  select jsonb_build_object(
    'id',claimed.id,'leaseToken',claimed.lease_token,'scheduledFor',claimed.scheduled_for,
    'attempt',claimed.attempt_count,'leaseExpiresAt',claimed.lease_expires_at,
    'tenant',jsonb_build_object('id',shop.id,'slug',shop.slug,'name',shop.name),
    'rule',jsonb_build_object('id',rule.id,'name',rule.name,'trigger',rule.trigger_type,
      'channel',rule.channel,'templateBody',rule.template_body,'conditions',rule.conditions),
    'recipient',case
      when claimed.recipient_type='platform_admin' then jsonb_build_object(
        'type','platform_admin','name',platform_settings.admin_name,
        'phone',platform_settings.admin_phone_normalized,'whatsappOptIn',platform_settings.whatsapp_opt_in)
      when claimed.recipient_type='owner' then jsonb_build_object(
        'type','owner','name',settings.owner_name,
        'phone',settings.owner_phone_normalized,'whatsappOptIn',settings.owner_whatsapp_opt_in)
      else jsonb_build_object(
        'type','client','name',client.name,
        'phone',private.normalize_whatsapp_number(client.phone_normalized,coalesce(settings.default_country_code,'55')),
        'whatsappOptIn',client.whatsapp_opt_in)
    end,
    'client',case when client.id is null then null else jsonb_build_object(
      'id',client.id,'name',client.name,'phone',client.phone_normalized,'whatsappOptIn',client.whatsapp_opt_in) end,
    'payload',claimed.payload
  ) as item
  from claimed
  join public.barbershops shop on shop.id=claimed.barbershop_id
  join public.automation_rules rule on rule.id=claimed.rule_id
  left join public.clients client on client.barbershop_id=claimed.barbershop_id and client.id=claimed.client_id
  left join public.tenant_notification_settings settings on settings.barbershop_id=claimed.barbershop_id
  left join public.platform_notification_settings platform_settings on platform_settings.profile_id=claimed.platform_profile_id
  order by claimed.scheduled_for,claimed.created_at;
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
  target_trigger text;
  target_phone text;
  default_country text;
  final_status text;
  safe_retry_seconds integer := least(greatest(coalesce(retry_after_seconds,300),60),3600);
begin
  if outcome not in ('sent','failed','retry') then raise exception 'Resultado de automação inválido' using errcode='22023'; end if;
  select run.* into target from public.automation_runs run where run.id=target_run_id for update;
  if target.id is null then raise exception 'Execução de automação não encontrada' using errcode='P0002'; end if;
  if target.lease_token is distinct from claimed_lease_token then raise exception 'Lease inválido ou substituído por outro processamento' using errcode='42501'; end if;
  if target.status in ('sent','failed') then return jsonb_build_object('id',target.id,'status',target.status,'alreadyCompleted',true); end if;
  if target.status<>'processing' or target.lease_expires_at<now() then raise exception 'Execução não está em processamento ou o lease expirou' using errcode='55000'; end if;

  if outcome='retry' and target.attempt_count<3 then
    update public.automation_runs set status='queued',scheduled_for=now()+make_interval(secs=>safe_retry_seconds),
      started_at=null,worker_id=null,lease_token=null,lease_expires_at=null,
      error_message=left(coalesce(failure_message,'Nova tentativa solicitada pelo worker'),1000)
    where id=target.id;
    return jsonb_build_object('id',target.id,'status','queued','retryAt',now()+make_interval(secs=>safe_retry_seconds),'alreadyCompleted',false);
  end if;

  final_status:=case when outcome='sent' then 'sent' else 'failed' end;
  update public.automation_runs set status=final_status,finished_at=now(),lease_expires_at=null,
    error_message=case when final_status='failed' then left(coalesce(failure_message,'Falha informada pelo worker'),1000) else null end
  where id=target.id;

  select rule.channel,rule.trigger_type into target_channel,target_trigger
  from public.automation_rules rule where rule.id=target.rule_id;
  select settings.default_country_code into default_country
  from public.tenant_notification_settings settings where settings.barbershop_id=target.barbershop_id;

  if target.recipient_type='platform_admin' then
    select settings.admin_phone_normalized into target_phone
    from public.platform_notification_settings settings where settings.profile_id=target.platform_profile_id;
  elsif target.recipient_type='owner' then
    select settings.owner_phone_normalized into target_phone
    from public.tenant_notification_settings settings where settings.barbershop_id=target.barbershop_id;
  else
    select private.normalize_whatsapp_number(client.phone_normalized,coalesce(default_country,'55')) into target_phone
    from public.clients client where client.barbershop_id=target.barbershop_id and client.id=target.client_id;
  end if;

  if final_status='sent' and target_channel='whatsapp' then
    insert into public.whatsapp_messages (
      barbershop_id,client_id,automation_run_id,provider_message_id,direction,
      body_preview,status,sent_at,recipient_type,recipient_phone_normalized
    ) values (
      target.barbershop_id,case when target.recipient_type='client' then target.client_id else null end,
      target.id,nullif(left(provider_message_id,255),''),'outbound',nullif(left(message_preview,500),''),
      'sent',now(),target.recipient_type,target_phone
    )
    on conflict (barbershop_id,automation_run_id) where direction='outbound' and automation_run_id is not null
    do update set provider_message_id=excluded.provider_message_id,body_preview=excluded.body_preview,
      status='sent',sent_at=excluded.sent_at,recipient_type=excluded.recipient_type,
      recipient_phone_normalized=excluded.recipient_phone_normalized;
  end if;

  if final_status='sent' and target_trigger='return_due' and target.client_reminder_id is not null then
    update public.reminders set status='sent',sent_at=now() where id=target.client_reminder_id and status='pending';
  end if;
  return jsonb_build_object('id',target.id,'status',final_status,'alreadyCompleted',false);
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
declare context jsonb;
begin
  select jsonb_build_object(
    'runId',run.id,'barbershopId',run.barbershop_id,'clientId',client.id,
    'recipientType',run.recipient_type,
    'recipientName',case when run.recipient_type='platform_admin' then platform_settings.admin_name when run.recipient_type='owner' then settings.owner_name else client.name end,
    'recipient',case when run.recipient_type='platform_admin' then platform_settings.admin_phone_normalized when run.recipient_type='owner' then settings.owner_phone_normalized else private.normalize_whatsapp_number(client.phone_normalized,settings.default_country_code) end,
    'phoneNumberId',connection.phone_number_id,'graphApiVersion',connection.graph_api_version,
    'accessToken',secret.decrypted_secret,'templateName',nullif(rule.conditions->>'meta_template_name',''),
    'templateLanguage',coalesce(nullif(rule.conditions->>'meta_template_language',''),'pt_BR'),
    'messagePreview',rule.template_body,'payload',run.payload
  ) into context
  from public.automation_runs run
  join public.automation_rules rule on rule.id=run.rule_id
  join public.barbershops shop on shop.id=run.barbershop_id and shop.active
  left join public.clients client on client.barbershop_id=run.barbershop_id and client.id=run.client_id
  join public.tenant_notification_settings settings on settings.barbershop_id=run.barbershop_id
  left join public.platform_notification_settings platform_settings on platform_settings.profile_id=run.platform_profile_id
  join public.whatsapp_connections connection on connection.barbershop_id=run.barbershop_id and connection.status='connected'
  join vault.decrypted_secrets secret on secret.id::text=connection.secret_reference
  where run.id=target_run_id and run.status='processing' and run.lease_token=claimed_lease_token
    and run.lease_expires_at>=now() and rule.active and rule.channel='whatsapp'
    and nullif(rule.conditions->>'meta_template_name','') is not null
    and (
      (run.recipient_type='client' and client.id is not null and client.whatsapp_opt_in
        and private.normalize_whatsapp_number(client.phone_normalized,settings.default_country_code) is not null)
      or (run.recipient_type='owner' and settings.owner_whatsapp_opt_in and settings.owner_phone_normalized is not null)
      or (run.recipient_type='platform_admin' and platform_settings.whatsapp_opt_in and platform_settings.admin_phone_normalized is not null)
    )
    and (
      rule.trigger_type='subscription_expiring'
      or exists (
        select 1 from public.subscriptions subscription where subscription.barbershop_id=run.barbershop_id
          and (subscription.status='active' or (subscription.status='trial' and (subscription.trial_ends_at is null or subscription.trial_ends_at>now())))
      )
    );
  if context is null then raise exception 'Execução não está pronta para envio pelo WhatsApp' using errcode='55000'; end if;
  return context;
end;
$$;

comment on table public.platform_notification_settings is
  'Destinatário global da Chrona para alertas de assinatura, vinculado a um perfil platform_admin.';
comment on function public.generate_universal_event_runs(timestamptz,integer) is
  'Prepara confirmações, aniversários, retornos de 20 dias e alertas de vencimento sem duplicidade.';

revoke all on function public.claim_automation_runs(text,integer,integer) from public,anon,authenticated;
revoke all on function public.finish_automation_run(uuid,uuid,text,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.get_whatsapp_delivery_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_automation_runs(text,integer,integer) to service_role;
grant execute on function public.finish_automation_run(uuid,uuid,text,text,text,text,integer) to service_role;
grant execute on function public.get_whatsapp_delivery_context(uuid,uuid) to service_role;

;
