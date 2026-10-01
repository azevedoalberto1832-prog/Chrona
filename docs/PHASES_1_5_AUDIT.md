# Auditoria das fases 1–5 — 01/10/2026

Esta auditoria compara o repositório com o Supabase vinculado `qcjjqdkjfvnbslbpnrgk`. Ela é o primeiro incremento seguro do novo ciclo: somente leitura, documentação e testes de autorização por funções de acesso. Nenhuma migration foi criada, reparada ou enviada; nenhuma configuração Meta/OpenAI foi alterada.

## Estado das 13 fases

| Fase | Estado | Evidência atual | Falta para concluir |
| --- | --- | --- | --- |
| 1. Auditoria e reconciliação | VALIDADA | Repositório, migrations, catálogo remoto, advisors, perfis, assinaturas e helpers foram comparados; o histórico local foi alinhado ao remoto sem mutar o banco. | Manter a checagem de migrations no fluxo de entrega e ampliar a matriz autenticada. |
| 2. Segurança e isolamento | EM IMPLEMENTAÇÃO | Todas as 37 tabelas públicas consultadas estão com RLS; helpers usam `auth.uid()` e `search_path` vazio. O owner Palazzo foi negado nos outros tenants pelas funções de acesso. | Reduzir permissões por papel, revisar RPCs públicas `SECURITY DEFINER`, corrigir Storage e automatizar testes negativos. |
| 3. Identidade, usuários e papéis | EM IMPLEMENTAÇÃO | Existem `platform_admin`, `owner`, `barber` e `receptionist`, onboarding e trilha de suporte. | Permitir vínculo seguro de um usuário a mais de um tenant e definir permissões granulares por papel. |
| 4. Lifecycle de lead/tenant | NÃO INICIADA | Há `barbershops.active` e status de assinatura, mas não uma máquina de estados própria do tenant/lead. | Modelar estados, transições, suspensão, reativação e auditoria antes de implementar. |
| 5. Planos, capabilities e quotas | EM IMPLEMENTAÇÃO | `Essential`/`Pro`, assinatura e `private.has_pro_access` protegem recursos Pro. | Substituir checks dispersos por catálogo de capabilities; quotas ainda não existem. |
| 6. Billing | EM IMPLEMENTAÇÃO | Assinaturas, trial e bloqueios existem. | Provedor, eventos, idempotência de cobrança e reconciliação financeira. |
| 7. Tenant Builder idempotente | EM IMPLEMENTAÇÃO | Edge Function `tenant-onboarding` e RPCs de provisionamento existem. | Tornar etapas retomáveis, observáveis e comprovadamente idempotentes. |
| 8. Lead/preview | NÃO INICIADA | Há preview visual do site de tenant, não um ciclo comercial de lead/preview. | Modelar entidade, expiração, conversão e descarte. |
| 9. Visual versionado | EM IMPLEMENTAÇÃO | Renderer, templates, paletas, tipografia, draft e published config existem. | Versionar schema/configuração visual e validar compatibilidade no servidor. |
| 10. IA conversacional | NÃO INICIADA | Existem fundações de chatbot/WhatsApp, mas o processador conversacional não está concluído. | Definir motor, limites, consentimento e piloto; depende de integração externa futura. |
| 11. AI Gateway | NÃO INICIADA | Não há gateway central comprovado. | Projetar contratos, budgets, observabilidade e isolamento antes de usar provedores. |
| 12. Projects e observabilidade de custo | NÃO INICIADA | Logs operacionais pontuais existem, sem modelo consolidado de custo/projeto. | Definir eventos, retenção, métricas e painéis. |
| 13. Integrações externas e produção | BLOQUEADA | Código Meta/n8n existe, porém segredos, templates, callback e operação externa não foram validados nesta etapa. | Requer credenciais, decisões e validação externa explícita; fora do escopo atual. |

## Resultado da reconciliação de migrations

O histórico coincide até `20260911151512` e volta a coincidir em `20260919235925`. No intervalo, há versões diferentes entre Git e remoto.

Somente no Git:

- `20260912003713`
- `20260912004723`
- `20260912005012`
- `20260912010717`
- `20260912011926`
- `20260912013052`
- `20260912013352`
- `20260912135139`
- `20260912135553`

Somente no remoto:

- `20260912004635`
- `20260912004826`
- `20260912005026`
- `20260912011701`
- `20260912012029`
- `20260912135239`
- `20260912135248`
- `20260912135256`
- `20260919181325`
- `20260919181340`
- `20260919181354`
- `20260919181521`

Resultado: o conteúdo remoto foi adotado como linhagem canônica no Git. Nove arquivos locais foram substituídos pelas versões/timestamps registrados no histórico remoto e quatro migrations que existiam apenas no Supabase foram recuperadas. `supabase migration list --linked` passou a mostrar correspondência integral até `20260920040000`, sem `migration repair` e sem reaplicar migrations históricas.

## Segurança e isolamento: evidências e riscos

### Evidências positivas

- As 37 tabelas do schema `public` inspecionadas possuem RLS habilitado.
- Os helpers `private.is_tenant_member`, `private.is_tenant_owner` e `private.is_platform_admin_profile` são `SECURITY DEFINER` com `search_path` vazio.
- Para o owner Palazzo, os helpers retornaram acesso apenas a `palazzo`; `nayara-lash` e `raquel-beauty` retornaram `false` para membro, owner e Pro.
- Para o `platform_admin`, os helpers retornaram acesso aos três tenants, como exige o modo de suporte.
- `private.has_pro_access` exige plano Pro, status `trial`/`active` e período vigente; `platform_admin` possui bypass operacional intencional.

### Riscos encontrados

1. **Permissão operacional ampla por membro.** Várias tabelas usam `private.is_tenant_member` em políticas `ALL`. Assim, `barber` e `receptionist` podem receber a mesma capacidade de escrita do owner em dados operacionais. O isolamento entre tenants está desenhado, mas a autorização dentro do tenant ainda não é granular.
2. **Vínculo operacional único é intencional.** `profiles.auth_user_id` é `UNIQUE`: cada usuário operacional pertence a uma empresa, que pode possuir vários profissionais. Somente `platform_admin` atravessa tenants. Não criar memberships multiempresa.
3. **Movimentação de logo entre pastas — corrigida.** A migration `20261001120000_harden_tenant_media_policies.sql` passou a revalidar bucket, extensão, perfil ativo e pasta de destino no `WITH CHECK`.
4. **Mídia do site sem ciclo de manutenção — corrigida.** A mesma migration adicionou `UPDATE` e `DELETE` para owner do tenant e Super Admin, mantendo JPEG e pasta do tenant na atualização.
5. **RPCs públicas privilegiadas.** Os advisors apontaram 10 funções `SECURITY DEFINER` executáveis por `anon` e `authenticated`: `complete_customer_profile`, `create_public_appointment`, `get_available_slots`, `get_customer_context`, `get_public_queue_ticket`, `get_public_shop`, `get_public_site_config`, `get_returning_client`, `join_public_queue` e `prepare_customer_phone_auth`. A exposição pode ser legítima, mas cada contrato precisa de revisão de minimização de dados, rate limit e abuso.
6. **Proteção de senha vazada desativada.** O advisor marcou `auth_leaked_password_protection`.
7. **Policies permissivas duplicadas.** `subscriptions` possui duas policies de `SELECT` para `authenticated`; revisar para reduzir ambiguidade.

Os testes executados nesta etapa validam diretamente os predicados de autorização com claims dos perfis reais. A matriz end-to-end via sessão Auth ainda é parcial porque não existe perfil ativo para Nayara e não foram usadas senhas/credenciais de usuários nesta auditoria.

## Identidade, lifecycle e planos

- Perfis remotos ativos: um `owner` ligado a Palazzo e um `platform_admin` sem tenant. Não existe owner ativo para Nayara na tabela `profiles`.
- Tenants: `palazzo` e `nayara-lash` estão ativos com Pro/trial vigente; `raquel-beauty` está ativa, mas sua assinatura está `suspended`.
- `barbershops.active` e `subscriptions.status` são sinais separados. Ainda não existe lifecycle explícito que impeça combinações contraditórias ou registre transições.
- O enforcement Pro existe para CRM/automações por `private.has_pro_access`, mas não há catálogo central de capabilities nem quotas mensuráveis.

## Primeiro incremento seguro

O incremento inicial concluído é esta linha de base auditável. Com a divergência reconciliada no Git, a próxima mudança de código deve permanecer pequena e verificável:

1. definir uma matriz de permissões por papel (`platform_admin`, `owner`, `receptionist`, `barber`);
2. criar testes automatizados de autorização para dois tenants e todos os papéis;
3. correções de Storage foram publicadas e verificadas em uma migration nova e linear;
4. depois modelar lifecycle e capabilities como contratos centrais, sem acoplar UI a nomes de plano.

## Bloqueios e decisões necessárias

- **Bloqueio técnico resolvido:** a linhagem local agora corresponde ao histórico remoto; futuras migrations devem ser lineares a partir de `20260920040000`.
- **Decisão de produto:** quais ações cada papel pode executar em agenda, clientes, caixa, serviços, profissionais e configurações.
- **Decisão de identidade — resolvida:** cada usuário operacional pertence a um único tenant; um tenant pode possuir vários profissionais; somente o Super Admin possui acesso transversal.
- **Decisão de lifecycle:** estados e transições válidas de lead, trial, active, suspended, cancelled e archived.
- **Decisão de plano:** capabilities e quotas de Essential/Pro devem ser dados centrais; o frontend apenas consulta o resultado.

## Comandos de validação utilizados

- `supabase migration list --linked`
- `supabase db advisors --linked --output json`
- consultas somente leitura a `pg_policies`, `pg_proc`, `profiles`, `barbershops` e `subscriptions`
- avaliação dos helpers privados com claims dos perfis reais, sem inserts/updates/deletes

