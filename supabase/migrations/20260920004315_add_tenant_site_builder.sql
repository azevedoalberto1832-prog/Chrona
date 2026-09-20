create table public.tenant_site_configs (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null unique references public.barbershops(id) on delete cascade,
  draft_config jsonb not null default '{}'::jsonb,
  published_config jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_site_configs_draft_object check (jsonb_typeof(draft_config)='object'),
  constraint tenant_site_configs_published_object check (jsonb_typeof(published_config)='object')
);

comment on table public.tenant_site_configs is
  'Configuração versionável da landing compartilhada. Draft alimenta o preview do Admin; published_config alimenta a página pública.';

alter table public.tenant_site_configs enable row level security;
revoke all on table public.tenant_site_configs from anon,authenticated;
grant select,insert,update on table public.tenant_site_configs to authenticated;

create policy tenant_site_configs_member_select
on public.tenant_site_configs for select to authenticated
using ((select private.is_tenant_member(barbershop_id)));

create policy tenant_site_configs_owner_insert
on public.tenant_site_configs for insert to authenticated
with check ((select private.is_tenant_owner(barbershop_id)));

create policy tenant_site_configs_owner_update
on public.tenant_site_configs for update to authenticated
using ((select private.is_tenant_owner(barbershop_id)))
with check ((select private.is_tenant_owner(barbershop_id)));

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
      jsonb_build_object('id','gallery','visible',false),jsonb_build_object('id','testimonials','visible',false),
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

create or replace function private.seed_tenant_site_config()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare base_config jsonb;
begin
  base_config:=private.default_tenant_site_config();
  insert into public.tenant_site_configs(barbershop_id,draft_config,published_config,published_at)
  values(new.id,base_config,base_config,now())
  on conflict(barbershop_id) do nothing;
  return new;
end;
$$;

revoke all on function private.seed_tenant_site_config() from public,anon,authenticated;

drop trigger if exists seed_tenant_site_config on public.barbershops;
create trigger seed_tenant_site_config
after insert on public.barbershops
for each row execute function private.seed_tenant_site_config();

insert into public.tenant_site_configs(barbershop_id,draft_config,published_config,published_at)
select shop.id,private.default_tenant_site_config(),private.default_tenant_site_config(),now()
from public.barbershops shop
on conflict(barbershop_id) do nothing;

with luxury as (
  select jsonb_build_object(
    'version',1,'template','luxury','palette','black-gold','fontPair','editorial-premium',
    'variants',jsonb_build_object('hero','split','button','classic','card','luxury','services','premium','professionals','premium','header','classic','footer','classic'),
    'sections',jsonb_build_array(
      jsonb_build_object('id','header','visible',true),jsonb_build_object('id','hero','visible',true),
      jsonb_build_object('id','services','visible',true),jsonb_build_object('id','about','visible',true),
      jsonb_build_object('id','differentials','visible',true),jsonb_build_object('id','professionals','visible',true),
      jsonb_build_object('id','gallery','visible',false),jsonb_build_object('id','testimonials','visible',false),
      jsonb_build_object('id','location','visible',true),jsonb_build_object('id','hours','visible',true),
      jsonb_build_object('id','final-cta','visible',true),jsonb_build_object('id','footer','visible',true)
    ),
    'content',jsonb_build_object(
      'hero',jsonb_build_object('eyebrow','Studio barber · experiência Palazzo','title','Precisão, presença e estilo.','subtitle','Cuidado masculino com técnica, ambiente e tempo dedicados a você.','ctaLabel','Escolher um horário','imageUrl','palazzo-logo.jpg'),
      'about',jsonb_build_object('eyebrow','A experiência','title','Mais que um corte. Um ritual de cuidado.','body','Na Palazzo, técnica e hospitalidade se encontram em um espaço pensado para quem valoriza presença, precisão e bons detalhes.'),
      'differentials',jsonb_build_array('Precisão em cada acabamento','Horário reservado para você','Experiência masculina sofisticada'),
      'gallery','[]'::jsonb,'testimonials','[]'::jsonb,
      'finalCta',jsonb_build_object('eyebrow','Seu próximo horário','title','Seu estilo merece tempo.','body','Escolha o serviço, o profissional e reserve a sua experiência Palazzo.','label','Agendar na Palazzo'),
      'whatsappMessage','Olá! Vim pelo site da Palazzo e gostaria de mais informações.'
    )
  ) as config
)
update public.tenant_site_configs site
set draft_config=luxury.config,published_config=luxury.config,published_at=now(),updated_at=now()
from public.barbershops shop,luxury
where site.barbershop_id=shop.id and shop.slug='palazzo';

create or replace function public.get_public_site_config(shop_slug text)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select site.published_config
  from public.tenant_site_configs site
  join public.barbershops shop on shop.id=site.barbershop_id
  join public.subscriptions subscription on subscription.barbershop_id=shop.id
  where shop.slug=lower(shop_slug)
    and shop.active
    and subscription.status in ('trial','active')
  limit 1;
$$;

revoke all on function public.get_public_site_config(text) from public;
grant execute on function public.get_public_site_config(text) to anon,authenticated;
