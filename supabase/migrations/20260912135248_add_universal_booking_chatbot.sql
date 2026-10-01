create table public.tenant_chatbot_settings (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  enabled boolean not null default false,
  assistant_name text not null default 'Assistente Chrona',
  welcome_message text not null default 'Olá! Vou ajudar você a marcar um horário.',
  fallback_message text not null default 'Não consegui entender. Escolha uma das opções para continuar.',
  handoff_message text not null default 'Vou encaminhar sua conversa para o responsável.',
  max_fallbacks smallint not null default 2 check (max_fallbacks between 1 and 5),
  standard_version integer not null default 1 check (standard_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chatbot_flow_steps (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  step_key text not null check (step_key in (
    'welcome','service','professional','date','slot','identity','consent',
    'confirmation','completed','fallback','handoff'
  )),
  position smallint not null check (position between 1 and 50),
  action_type text not null check (action_type in ('menu','collect','confirm','terminal','handoff')),
  prompt_template text not null,
  configuration jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  standard_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id,step_key)
);

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  client_id uuid,
  customer_phone_normalized text not null check (customer_phone_normalized ~ '^[1-9][0-9]{9,14}$'),
  state text not null default 'new' check (state in (
    'new','awaiting_service','awaiting_professional','awaiting_date','awaiting_slot',
    'awaiting_identity','awaiting_consent','awaiting_confirmation','booking',
    'completed','handoff','closed'
  )),
  context jsonb not null default '{}'::jsonb,
  fallback_count smallint not null default 0 check (fallback_count between 0 and 10),
  human_handoff boolean not null default false,
  service_window_expires_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (barbershop_id,client_id) references public.clients(barbershop_id,id) on delete set null (client_id),
  unique (barbershop_id,customer_phone_normalized),
  unique (barbershop_id,id)
);

create table public.chatbot_outbox (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  conversation_id uuid not null,
  recipient_phone_normalized text not null check (recipient_phone_normalized ~ '^[1-9][0-9]{9,14}$'),
  message_type text not null check (message_type in ('text','interactive','template')),
  payload jsonb not null,
  deduplication_key text not null,
  status text not null default 'queued' check (status in ('queued','processing','sent','failed','cancelled')),
  scheduled_for timestamptz not null default now(),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  worker_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (barbershop_id,conversation_id) references public.whatsapp_conversations(barbershop_id,id) on delete cascade,
  unique (barbershop_id,deduplication_key)
);

create index whatsapp_conversations_state_idx
  on public.whatsapp_conversations (barbershop_id,state,updated_at desc);
create index chatbot_outbox_queue_idx
  on public.chatbot_outbox (status,scheduled_for)
  where status='queued';

alter table public.tenant_chatbot_settings enable row level security;
alter table public.chatbot_flow_steps enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.chatbot_outbox enable row level security;

create policy tenant_chatbot_settings_tenant_select
on public.tenant_chatbot_settings for select to authenticated
using ((select private.is_tenant_member(barbershop_id)));

create policy tenant_chatbot_settings_tenant_update
on public.tenant_chatbot_settings for update to authenticated
using ((select private.is_tenant_member(barbershop_id)))
with check ((select private.is_tenant_member(barbershop_id)));

create policy chatbot_flow_steps_tenant_select
on public.chatbot_flow_steps for select to authenticated
using ((select private.is_tenant_member(barbershop_id)));

create policy whatsapp_conversations_tenant_select
on public.whatsapp_conversations for select to authenticated
using ((select private.is_tenant_member(barbershop_id)));

create policy chatbot_outbox_tenant_select
on public.chatbot_outbox for select to authenticated
using ((select private.is_tenant_member(barbershop_id)));

grant select,update on public.tenant_chatbot_settings to authenticated;
grant select on public.chatbot_flow_steps,public.whatsapp_conversations,public.chatbot_outbox to authenticated;

create or replace function private.seed_tenant_chatbot_defaults()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.tenant_chatbot_settings (barbershop_id)
  values (new.id)
  on conflict (barbershop_id) do nothing;

  insert into public.chatbot_flow_steps (
    barbershop_id,step_key,position,action_type,prompt_template,configuration
  )
  select new.id,step.step_key,step.position,step.action_type,step.prompt_template,step.configuration
  from (values
    ('welcome',1,'menu','Olá! Eu sou o assistente de {{empresa.nome}}. Vou ajudar você a marcar um horário.',
      '{"next":"service"}'::jsonb),
    ('service',2,'menu','Qual serviço você deseja?',
      '{"source":"services","next":"professional"}'::jsonb),
    ('professional',3,'menu','Com qual profissional você prefere ser atendido?',
      '{"source":"professionals","allow_any":true,"next":"date"}'::jsonb),
    ('date',4,'menu','Qual dia fica melhor para você?',
      '{"source":"business_hours","days_ahead":30,"next":"slot"}'::jsonb),
    ('slot',5,'menu','Escolha um dos horários disponíveis.',
      '{"source":"available_slots","interval_minutes":15,"next":"identity"}'::jsonb),
    ('identity',6,'collect','Para concluir, informe seu nome completo.',
      '{"required":["name"],"optional":["birth_date"],"next":"consent"}'::jsonb),
    ('consent',7,'confirm','Você aceita receber a confirmação e os lembretes deste agendamento pelo WhatsApp?',
      '{"next":"confirmation","decline_allowed":true}'::jsonb),
    ('confirmation',8,'confirm','Confira serviço, profissional, data e horário antes de confirmar.',
      '{"action":"create_appointment","next":"completed"}'::jsonb),
    ('completed',9,'terminal','Pronto! Seu horário foi marcado. A confirmação será enviada por aqui.',
      '{"restart_keywords":["agendar","menu","novo horário"]}'::jsonb),
    ('fallback',10,'collect','Não consegui entender. Toque em uma opção ou digite menu para recomeçar.',
      '{"max_attempts":2,"next":"handoff"}'::jsonb),
    ('handoff',11,'handoff','Vou encaminhar você para o responsável da empresa.',
      '{"notify":"owner"}'::jsonb)
  ) as step(step_key,position,action_type,prompt_template,configuration)
  on conflict (barbershop_id,step_key) do nothing;

  return new;
end;
$$;

revoke all on function private.seed_tenant_chatbot_defaults() from public,anon,authenticated;

create trigger barbershops_seed_chatbot_defaults
after insert on public.barbershops
for each row execute function private.seed_tenant_chatbot_defaults();

insert into public.tenant_chatbot_settings (barbershop_id)
select id from public.barbershops
on conflict (barbershop_id) do nothing;

insert into public.chatbot_flow_steps (
  barbershop_id,step_key,position,action_type,prompt_template,configuration
)
select shop.id,step.step_key,step.position,step.action_type,step.prompt_template,step.configuration
from public.barbershops shop
cross join (values
  ('welcome',1,'menu','Olá! Eu sou o assistente de {{empresa.nome}}. Vou ajudar você a marcar um horário.',
    '{"next":"service"}'::jsonb),
  ('service',2,'menu','Qual serviço você deseja?',
    '{"source":"services","next":"professional"}'::jsonb),
  ('professional',3,'menu','Com qual profissional você prefere ser atendido?',
    '{"source":"professionals","allow_any":true,"next":"date"}'::jsonb),
  ('date',4,'menu','Qual dia fica melhor para você?',
    '{"source":"business_hours","days_ahead":30,"next":"slot"}'::jsonb),
  ('slot',5,'menu','Escolha um dos horários disponíveis.',
    '{"source":"available_slots","interval_minutes":15,"next":"identity"}'::jsonb),
  ('identity',6,'collect','Para concluir, informe seu nome completo.',
    '{"required":["name"],"optional":["birth_date"],"next":"consent"}'::jsonb),
  ('consent',7,'confirm','Você aceita receber a confirmação e os lembretes deste agendamento pelo WhatsApp?',
    '{"next":"confirmation","decline_allowed":true}'::jsonb),
  ('confirmation',8,'confirm','Confira serviço, profissional, data e horário antes de confirmar.',
    '{"action":"create_appointment","next":"completed"}'::jsonb),
  ('completed',9,'terminal','Pronto! Seu horário foi marcado. A confirmação será enviada por aqui.',
    '{"restart_keywords":["agendar","menu","novo horário"]}'::jsonb),
  ('fallback',10,'collect','Não consegui entender. Toque em uma opção ou digite menu para recomeçar.',
    '{"max_attempts":2,"next":"handoff"}'::jsonb),
  ('handoff',11,'handoff','Vou encaminhar você para o responsável da empresa.',
    '{"notify":"owner"}'::jsonb)
) as step(step_key,position,action_type,prompt_template,configuration)
on conflict (barbershop_id,step_key) do nothing;

comment on table public.tenant_chatbot_settings is
  'Configuração mínima do recepcionista universal Chrona; começa desligado até a conexão Meta.';
comment on table public.chatbot_flow_steps is
  'Fluxo replicado de marcação: serviço, profissional, data, horário, identificação, consentimento e confirmação.';
comment on table public.whatsapp_conversations is
  'Estado isolado de cada conversa, identificado por tenant e telefone do cliente.';
comment on table public.chatbot_outbox is
  'Fila idempotente das respostas livres/interativas do chatbot dentro da janela de atendimento.';

;
