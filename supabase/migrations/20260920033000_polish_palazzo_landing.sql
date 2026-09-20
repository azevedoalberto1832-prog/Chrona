update public.tenant_site_configs site
set draft_config = jsonb_set(
      jsonb_set(
        jsonb_set(site.draft_config,'{content,hero,eyebrow}',to_jsonb('Palazzo Barbearia'::text),true),
        '{variants,hero}',
        '"centered"'::jsonb,
        true
      ),
      '{variants,services}',
      '"grid"'::jsonb,
      true
    ),
    published_config = jsonb_set(
      jsonb_set(
        jsonb_set(site.published_config,'{content,hero,eyebrow}',to_jsonb('Palazzo Barbearia'::text),true),
        '{variants,hero}',
        '"centered"'::jsonb,
        true
      ),
      '{variants,services}',
      '"grid"'::jsonb,
      true
    ),
    published_at = now(),
    updated_at = now()
from public.barbershops shop
where shop.id=site.barbershop_id and shop.slug='palazzo';

comment on table public.tenant_site_configs is
  'Configuração controlada da landing por tenant. Palazzo usa hero centralizado e grade de serviços alinhada.';
