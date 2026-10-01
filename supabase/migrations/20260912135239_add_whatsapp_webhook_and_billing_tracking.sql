alter table public.whatsapp_connections
  add column billing_responsibility text not null default 'tenant'
    check (billing_responsibility in ('tenant','platform')),
  add column last_webhook_at timestamptz;

comment on column public.whatsapp_connections.billing_responsibility is
  'Define quem paga a Meta. tenant = forma de pagamento da WABA da empresa; platform = Chrona paga e refatura.';

alter table public.clients
  add column whatsapp_opt_out_at timestamptz,
  add column whatsapp_last_inbound_at timestamptz,
  add column whatsapp_last_outbound_at timestamptz;

alter table public.whatsapp_messages
  add column received_at timestamptz,
  add column failed_at timestamptz,
  add column error_code text,
  add column conversation_id text,
  add column origin_type text,
  add column pricing_category text,
  add column pricing_model text,
  add column billable boolean;

create unique index whatsapp_messages_provider_message_uidx
  on public.whatsapp_messages (provider_message_id)
  where provider_message_id is not null;

create index whatsapp_messages_billing_idx
  on public.whatsapp_messages (barbershop_id, pricing_category, created_at)
  where direction='outbound' and provider_message_id is not null;

create or replace function public.process_meta_whatsapp_event(
  meta_phone_number_id text,
  meta_event_type text,
  meta_external_id text,
  meta_provider_message_id text default null,
  meta_sender_phone text default null,
  meta_message_status text default null,
  meta_event_at timestamptz default now(),
  meta_body_preview text default null,
  meta_conversation_id text default null,
  meta_origin_type text default null,
  meta_pricing_category text default null,
  meta_pricing_model text default null,
  meta_billable boolean default null,
  meta_error_code text default null,
  meta_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_connection public.whatsapp_connections;
  target_client_id uuid;
  target_message_id uuid;
  target_event_id uuid;
  normalized_sender text;
  safe_event_at timestamptz := coalesce(meta_event_at,now());
  safe_status text;
  is_opt_out boolean := false;
begin
  if coalesce(meta_phone_number_id,'') !~ '^[0-9]{5,30}$'
    or coalesce(meta_external_id,'') = ''
    or length(meta_external_id) > 500
    or meta_event_type not in ('message','status')
  then
    raise exception 'Evento Meta inválido' using errcode='22023';
  end if;

  select connection.* into target_connection
  from public.whatsapp_connections connection
  where connection.phone_number_id=meta_phone_number_id
    and connection.status='connected';

  if target_connection.id is null then
    return jsonb_build_object('ignored',true,'reason','unknown_phone_number');
  end if;

  insert into public.integration_events (
    barbershop_id,source,event_type,external_id,status,payload
  ) values (
    target_connection.barbershop_id,'meta_whatsapp',meta_event_type,
    left(meta_external_id,500),'received',coalesce(meta_payload,'{}'::jsonb)
  )
  on conflict (source,external_id) do nothing
  returning id into target_event_id;

  if target_event_id is null then
    return jsonb_build_object('duplicate',true,'externalId',meta_external_id);
  end if;

  update public.whatsapp_connections
  set last_webhook_at=safe_event_at,updated_at=now()
  where id=target_connection.id;

  if meta_event_type='message' then
    normalized_sender:=private.normalize_whatsapp_number(meta_sender_phone,'55');
    if normalized_sender is null then
      update public.integration_events
      set status='ignored',processed_at=now(),error_message='Remetente inválido'
      where id=target_event_id;
      return jsonb_build_object('ignored',true,'reason','invalid_sender');
    end if;

    select client.id into target_client_id
    from public.clients client
    where client.barbershop_id=target_connection.barbershop_id
      and private.normalize_whatsapp_number(client.phone_normalized,'55')=normalized_sender
    order by client.updated_at desc
    limit 1;

    is_opt_out:=lower(btrim(coalesce(meta_body_preview,''))) ~
      '^(sair|pare|parar|cancelar|cancelar mensagens|não quero receber|nao quero receber)$';

    insert into public.whatsapp_messages (
      barbershop_id,client_id,provider_message_id,direction,body_preview,status,
      received_at,created_at,recipient_type,recipient_phone_normalized
    ) values (
      target_connection.barbershop_id,target_client_id,left(coalesce(meta_provider_message_id,meta_external_id),255),
      'inbound',nullif(left(meta_body_preview,500),''),'received',safe_event_at,
      safe_event_at,'client',normalized_sender
    )
    on conflict (provider_message_id) where provider_message_id is not null do nothing
    returning id into target_message_id;

    if target_client_id is not null then
      update public.clients
      set whatsapp_last_inbound_at=safe_event_at,
          whatsapp_opt_in=case when is_opt_out then false else whatsapp_opt_in end,
          whatsapp_opt_in_at=case when is_opt_out then null else whatsapp_opt_in_at end,
          whatsapp_opt_out_at=case when is_opt_out then safe_event_at else whatsapp_opt_out_at end,
          updated_at=now()
      where id=target_client_id;
    end if;

    update public.integration_events
    set status='processed',processed_at=now()
    where id=target_event_id;

    return jsonb_build_object(
      'processed',true,'eventType','message','tenantId',target_connection.barbershop_id,
      'clientId',target_client_id,'messageId',target_message_id,'optOut',is_opt_out
    );
  end if;

  safe_status:=case meta_message_status
    when 'sent' then 'sent'
    when 'delivered' then 'delivered'
    when 'read' then 'read'
    when 'failed' then 'failed'
    else null
  end;

  if safe_status is null then
    update public.integration_events
    set status='ignored',processed_at=now(),error_message='Status Meta desconhecido'
    where id=target_event_id;
    return jsonb_build_object('ignored',true,'reason','unknown_status');
  end if;

  update public.whatsapp_messages message
  set status=safe_status,
      sent_at=case when safe_status='sent' then coalesce(message.sent_at,safe_event_at) else message.sent_at end,
      delivered_at=case when safe_status in ('delivered','read') then coalesce(message.delivered_at,safe_event_at) else message.delivered_at end,
      read_at=case when safe_status='read' then coalesce(message.read_at,safe_event_at) else message.read_at end,
      failed_at=case when safe_status='failed' then coalesce(message.failed_at,safe_event_at) else message.failed_at end,
      error_code=coalesce(nullif(left(meta_error_code,100),''),message.error_code),
      conversation_id=coalesce(nullif(left(meta_conversation_id,255),''),message.conversation_id),
      origin_type=coalesce(nullif(left(meta_origin_type,100),''),message.origin_type),
      pricing_category=coalesce(nullif(left(meta_pricing_category,100),''),message.pricing_category),
      pricing_model=coalesce(nullif(left(meta_pricing_model,100),''),message.pricing_model),
      billable=coalesce(meta_billable,message.billable)
  where message.barbershop_id=target_connection.barbershop_id
    and message.provider_message_id=coalesce(meta_provider_message_id,meta_external_id)
  returning message.id,message.client_id into target_message_id,target_client_id;

  if target_message_id is null then
    update public.integration_events
    set status='ignored',processed_at=now(),error_message='Mensagem de saída ainda não localizada'
    where id=target_event_id;
    return jsonb_build_object('ignored',true,'reason','outbound_message_not_found');
  end if;

  if target_client_id is not null then
    update public.clients
    set whatsapp_last_outbound_at=safe_event_at,updated_at=now()
    where id=target_client_id;
  end if;

  if safe_status='failed' then
    update public.automation_runs run
    set status='failed',finished_at=safe_event_at,
        error_message='Meta webhook: '||coalesce(nullif(left(meta_error_code,100),''),'falha de entrega')
    from public.whatsapp_messages message
    where message.id=target_message_id
      and run.id=message.automation_run_id
      and run.status='sent';
  end if;

  update public.integration_events
  set status='processed',processed_at=now()
  where id=target_event_id;

  return jsonb_build_object(
    'processed',true,'eventType','status','status',safe_status,
    'tenantId',target_connection.barbershop_id,'messageId',target_message_id,
    'billable',meta_billable,'pricingCategory',meta_pricing_category
  );
end;
$$;

comment on function public.process_meta_whatsapp_event(text,text,text,text,text,text,timestamptz,text,text,text,text,text,boolean,text,jsonb) is
  'Processa webhooks Meta assinados, isola o tenant pelo phone_number_id, deduplica, registra entrega/leitura/tarifação e aplica opt-out.';

revoke all on function public.process_meta_whatsapp_event(text,text,text,text,text,text,timestamptz,text,text,text,text,text,boolean,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.process_meta_whatsapp_event(text,text,text,text,text,text,timestamptz,text,text,text,text,text,boolean,text,jsonb)
  to service_role;

;
