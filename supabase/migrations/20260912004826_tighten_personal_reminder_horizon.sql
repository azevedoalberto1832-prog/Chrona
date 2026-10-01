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
      and reminder.next_run_at <= reference_time + interval '5 minutes'
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

revoke all on function public.generate_due_automation_runs(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.generate_due_automation_runs(timestamptz, integer) to service_role;

;
