create or replace function private.default_tenant_site_config()
returns jsonb
language sql
immutable
set search_path=''
as $$
  select jsonb_build_object(
    'version',1,
    'template','clean',
    'palette','minimal-white',
    'fontPair','clean-professional',
    'variants',jsonb_build_object('hero','centered','button','outline','card','minimal','services','list','professionals','minimal','header','minimal','footer','minimal'),
    'sections',jsonb_build_array(
      jsonb_build_object('id','header','visible',true),jsonb_build_object('id','hero','visible',true),
      jsonb_build_object('id','services','visible',true),jsonb_build_object('id','about','visible',true),
      jsonb_build_object('id','differentials','visible',true),jsonb_build_object('id','professionals','visible',true),
      jsonb_build_object('id','gallery','visible',true),jsonb_build_object('id','testimonials','visible',false),
      jsonb_build_object('id','location','visible',true),jsonb_build_object('id','hours','visible',true),
      jsonb_build_object('id','final-cta','visible',true),jsonb_build_object('id','footer','visible',true)
    ),
    'content',jsonb_build_object(
      'hero',jsonb_build_object('eyebrow','Agendamento online','title','','subtitle','','ctaLabel','Agendar horário','imageUrl',''),
      'about',jsonb_build_object('eyebrow','Nossa essência','title','Atendimento com identidade','body','Uma experiência cuidada em cada detalhe, do agendamento ao resultado.'),
      'differentials',jsonb_build_array('Atendimento com hora marcada','Profissionais especializados','Experiência pensada para você'),
      'gallery','[]'::jsonb,'testimonials','[]'::jsonb,
      'finalCta',jsonb_build_object('eyebrow','Seu próximo horário','title','Pronto para se cuidar?','body','Escolha o serviço e reserve seu melhor horário.','label','Agendar agora'),
      'whatsappMessage','Olá! Vim pelo site e gostaria de mais informações.'
    )
  );
$$;

revoke all on function private.default_tenant_site_config() from public,anon,authenticated;

update public.tenant_site_configs
set draft_config=jsonb_set(
      draft_config,
      '{sections}',
      (select jsonb_agg(case when section->>'id'='gallery' then jsonb_set(section,'{visible}','true'::jsonb,true) else section end order by ordinal)
       from jsonb_array_elements(draft_config->'sections') with ordinality as item(section,ordinal)),
      true
    ),
    published_config=jsonb_set(
      published_config,
      '{sections}',
      (select jsonb_agg(case when section->>'id'='gallery' then jsonb_set(section,'{visible}','true'::jsonb,true) else section end order by ordinal)
       from jsonb_array_elements(published_config->'sections') with ordinality as item(section,ordinal)),
      true
    ),
    updated_at=now();

comment on function private.default_tenant_site_config() is
  'Configuração inicial universal: galeria habilitada e renderizada apenas quando o proprietário publicar fotos.';
