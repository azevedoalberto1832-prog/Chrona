create index chatbot_outbox_conversation_fk_idx
  on public.chatbot_outbox (barbershop_id,conversation_id);

create index whatsapp_conversations_client_fk_idx
  on public.whatsapp_conversations (barbershop_id,client_id)
  where client_id is not null;

create index platform_support_access_logs_profile_fk_idx
  on public.platform_support_access_logs (profile_id);

;
