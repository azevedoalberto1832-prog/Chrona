create or replace function private.seed_tenant_operational_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pipeline_id uuid;
begin
  insert into public.tenant_notification_settings (barbershop_id)
  values (new.id)
  on conflict (barbershop_id) do nothing;

  insert into public.crm_pipelines (barbershop_id, name)
  values (new.id, 'Relacionamento')
  on conflict (barbershop_id, name) do update set name = excluded.name
  returning id into v_pipeline_id;

  insert into public.crm_stages (barbershop_id, pipeline_id, name, position, color)
  select new.id, v_pipeline_id, stage.name, stage.position, stage.color
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

;
