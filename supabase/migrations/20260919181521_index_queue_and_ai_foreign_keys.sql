create index if not exists queue_entries_tenant_professional_fk_idx
  on public.queue_entries(barbershop_id, professional_id);

create index if not exists queue_entry_services_tenant_idx
  on public.queue_entry_services(barbershop_id);

create index if not exists queue_entry_services_tenant_entry_fk_idx
  on public.queue_entry_services(barbershop_id, queue_entry_id);

create index if not exists queue_entry_services_tenant_service_fk_idx
  on public.queue_entry_services(barbershop_id, service_id);

create index if not exists tenant_ai_settings_updated_by_fk_idx
  on public.tenant_ai_settings(updated_by);

;
