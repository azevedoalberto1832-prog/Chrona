update public.tenant_site_configs site
set draft_config=jsonb_set(
      site.draft_config,
      '{content,differentials}',
      to_jsonb(array[
        'Precisão em cada acabamento',
        'Horário reservado para você',
        'Experiência masculina sofisticada',
        'Presença que se percebe nos detalhes'
      ]::text[]),
      true
    ),
    published_config=jsonb_set(
      site.published_config,
      '{content,differentials}',
      to_jsonb(array[
        'Precisão em cada acabamento',
        'Horário reservado para você',
        'Experiência masculina sofisticada',
        'Presença que se percebe nos detalhes'
      ]::text[]),
      true
    ),
    published_at=now(),
    updated_at=now()
from public.barbershops shop
where shop.id=site.barbershop_id and shop.slug='palazzo';
