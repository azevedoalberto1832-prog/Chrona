# PROJECT_STATE.md — Estado operacional da Chrona

> Memória viva do estado atual. Este arquivo descreve somente fatos sustentados pelo repositório/documentação confiável no momento da revisão. `IMPLEMENTADO` não significa automaticamente `VALIDADO` ou `PUBLICADO`.

## Estado atual

Chrona possui uma aplicação web estática multi-tenant conectada ao Supabase, com agenda pública/admin, persistência PostgreSQL, RLS, Super Admin, CRM e fundações de automação/WhatsApp presentes no repositório. O frontend continua concentrado principalmente em `app.js` e não há `package.json` no repositório atual.

Palazzo é o tenant real de referência e Nayara Lash Designer é o tenant de validação multi-segmento segundo a documentação do projeto. O tenant público é resolvido por `?tenant=<slug>`; o código atual também mapeia o hostname `palazzo-barber.vercel.app` para o slug `palazzo`.

A camada Meta/WhatsApp possui schema, Edge Functions, fila, webhook e estruturas do chatbot, mas a própria documentação vigente ainda exige configuração de segredos, validação real do webhook, aprovação/vinculação de templates e implementação do processador da máquina de estados antes do piloto. Portanto não considerar o chatbot operacional em produção.

## Funcionalidades

| Funcionalidade | Estado | Evidência/observação |
| --- | --- | --- |
| Núcleo multi-tenant com `barbershop_id` e RLS | IMPLEMENTADO | Migrations criam entidades, políticas e helpers de isolamento. |
| Catálogo público de serviços/profissionais | IMPLEMENTADO | RPC pública e frontend carregam dados por tenant. |
| Disponibilidade e bloqueio de conflito de agenda | IMPLEMENTADO | RPC de slots + constraint de não sobreposição para horários ativos. |
| Criação pública de agendamento | IMPLEMENTADO | RPC versionada no banco e fluxo no frontend. |
| Área administrativa | IMPLEMENTADO | UI e operações persistentes existem em `app.js`; README lista agenda, clientes, caixa, lembretes, serviços e configurações. |
| Caixa ligado à conclusão de atendimento | IMPLEMENTADO | Estrutura/RPCs versionadas; preservar idempotência. |
| Lembrete/retorno por serviço | IMPLEMENTADO | Migrations e arquitetura definem `return_interval_days` e geração de retorno. |
| Super Admin e gestão de tenants/assinaturas | IMPLEMENTADO | UI, perfis de plataforma, onboarding e controles existem no repositório. |
| Onboarding de tenant + convite do responsável | IMPLEMENTADO | Edge Function autenticada `tenant-onboarding` e RPCs relacionadas. |
| Direção visual automática por tenant | IMPLEMENTADO | `visual_direction` e seleção `editorial`/`studio`/`serene` estão no código/migration. Não equivale à biblioteca de templates avançada discutida futuramente. |
| CRM com pipelines/etapas/oportunidades | IMPLEMENTADO | Schema e CRUD constam do código/documentação. |
| Fila de automações para n8n | IMPLEMENTADO | Edge Function, lease, deduplicação e protocolo documentados. Operação externa contínua não foi comprovada nesta revisão. |
| Conexão Meta Cloud API por tenant | IMPLEMENTADO | Edge Function e schema existem; token é tratado server-side/Vault. Conexão real de cada tenant não foi comprovada nesta revisão. |
| Matriz universal de notificações | IMPLEMENTADO | Regras/seeds e geração estão nas migrations; regras dependentes de Meta nascem inativas. |
| Webhook Meta assinado + tracking de status | IMPLEMENTADO | Edge Function/schema existem. Validação operacional real do callback permanece pendente segundo documentação. |
| Chatbot universal de agendamento | EM IMPLEMENTAÇÃO | Persistência, estados, outbox, webhook e configuração existem, mas `ARCHITECTURE.md` ainda manda implementar o processador da máquina de estados e ativar piloto. |
| Hostname dedicado Palazzo no frontend | IMPLEMENTADO | `palazzo-barber.vercel.app` resolve para tenant `palazzo` no commit mais recente. Deploy funcional desse hostname não foi validado nesta revisão. |
| Biblioteca de templates/landing pages altamente customizáveis | PLANEJADO | Não há contrato/template engine equivalente no estado inspecionado. A direção visual atual é limitada a estilos/direções existentes. |
| Fontes selecionáveis por cliente | PLANEJADO | Não encontrada implementação configurável por tenant no estado inspecionado. |
| Subdomínio automático `cliente.chronasystems.com.br` | PLANEJADO | Não encontrada infraestrutura de provisionamento wildcard/subdomínio no repositório atual. |

## Integrações

| Integração | Estado | Situação atual |
| --- | --- | --- |
| Supabase/PostgreSQL/Auth/RLS | IMPLEMENTADO | É a persistência e camada de segurança principal. Projeto configurado em `supabase/config.toml`. |
| GitHub Pages | IMPLEMENTADO | Workflow publica a raiz em pushes para `main`; esta revisão não usa a mera existência do workflow como prova de deploy atual bem-sucedido. |
| Vercel / hostname Palazzo | EM IMPLEMENTAÇÃO | Frontend reconhece `palazzo-barber.vercel.app`; configuração/deploy externo não foi comprovado pelo repositório. |
| n8n | IMPLEMENTADO | Contrato server-side da fila está pronto; execução de worker externo em produção não foi comprovada. |
| Meta WhatsApp Cloud API v26.0 | EM IMPLEMENTAÇÃO | Código de conexão/envio/webhook existe. Faltam confirmações externas de segredos, callback e templates para operação real. |
| Supabase Vault para token Meta | IMPLEMENTADO | Arquitetura/migrations/Edge Functions foram desenhadas para guardar somente referência operacional ao segredo. |

## Decisões vigentes

- Banco único multi-tenant; não criar backend/repositório por tenant como padrão.
- `barbershop_id` + RLS são fronteira de isolamento e não podem ser contornados por conveniência de frontend.
- Agenda é fonte da verdade dos atendimentos; CRM e WhatsApp são camadas auxiliares.
- n8n orquestra externamente, mas não recebe token Meta do tenant nem acesso irrestrito ao banco.
- Cada tenant possui conexão/remetente Meta próprio; destinatários de cliente, responsável e admin de plataforma têm escopos distintos.
- Automação deve permanecer idempotente e deduplicável.
- Regras Meta dependentes de configuração externa permanecem inativas até templates/conexão válidos.
- Chatbot é universal por código, isolado por tenant e desativado até ativação controlada.
- Super Admin pode verificar painel de tenant, mas a entrada deve ser auditada.
- Planos reconhecidos pelo onboarding atual: Essential e Pro.
- Personalização visual existente não autoriza mudanças no Core, RLS, agenda, billing ou integrações.

## Problemas conhecidos

- `app.js` é um arquivo monolítico grande, concentrando muitas responsabilidades; isso aumenta risco de regressão em alterações não relacionadas.
- O estado externo da Meta não é demonstrável apenas pelo repositório. Segredos, webhook real e templates aprovados precisam ser verificados no ambiente antes de marcar integração como VALIDADA.
- O processador completo da máquina de estados do chatbot ainda aparece como próximo passo na arquitetura.
- O mapeamento do hostname Palazzo está hardcoded no frontend; não existe ainda provisionamento genérico de domínio/subdomínio por tenant no código inspecionado.
- README descreve várias capacidades como funcionalidades; agentes devem confirmar cada uma contra código/migrations antes de elevar seu estado para VALIDADO/PUBLICADO.

## Última alteração relevante

Commit anterior a esta memória operacional: `14669ab4dbcd6b6d635101488b5ec3e05f8dfd49` (`feat: add Palazzo tenant domain`, 2026-09-13). Ele adicionou em `app.js` o mapeamento de `palazzo-barber.vercel.app` para o tenant `palazzo`. Isso comprova implementação no código, não validação do domínio/deploy externo.

Esta tarefa adiciona apenas documentação operacional (`AGENTS.md` e `PROJECT_STATE.md`) e não altera funcionalidade.

## Próximo incremento recomendado

Antes de iniciar novas funcionalidades, verificar o ambiente real da integração Meta e fechar o ponto já aberto pela arquitetura: segredos/callback/templates e processador da máquina de estados do chatbot, com piloto controlado e evidência funcional antes de marcar como VALIDADO.

A futura camada de landing pages/templates customizáveis deve ser tratada como incremento separado. Primeiro definir contrato de customização que não atravesse o Chrona Core nem o isolamento multi-tenant; não confundir a atual `visual_direction` com uma template engine completa.

## Não fazer

- Não assumir que landing page modular, biblioteca de templates, fontes selecionáveis ou subdomínios automáticos já existem.
- Não marcar Meta/chatbot como operacional apenas porque migrations e Edge Functions existem.
- Não transformar direção visual atual em fork de código por tenant.
- Não duplicar clientes/agendamentos dentro do CRM.
- Não expor secrets/tokens no navegador, Git ou workflow n8n exportado.
- Não enfraquecer RLS para resolver erro de acesso.
- Não remover deduplicação/lease/idempotência das automações.
- Não ativar regras WhatsApp ou chatbot antes dos requisitos externos e consentimento.
- Não remover auditoria do modo de suporte do Super Admin.
- Não reestruturar o frontend monolítico incidentalmente durante uma tarefa funcional pequena; refatoração deve ter escopo próprio e testes adequados.

## REGRA DE MANUTENÇÃO

`AGENTS.md` deve mudar pouco e somente quando arquitetura, regras permanentes ou protocolo mudarem.

`PROJECT_STATE.md` é memória viva e deve acompanhar o projeto. Não transformar este arquivo em histórico infinito. Quando fatos antigos deixarem de representar o estado atual, consolidar ou remover; o histórico detalhado já existe no Git.
