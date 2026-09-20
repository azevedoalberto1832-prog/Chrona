# PROJECT_STATE.md — Estado operacional da Chrona

> Memória viva do estado atual. Este arquivo descreve somente fatos sustentados pelo repositório/documentação confiável no momento da revisão. `IMPLEMENTADO` não significa automaticamente `VALIDADO` ou `PUBLICADO`.

## Estado atual

Chrona possui uma aplicação web estática multi-tenant conectada ao Supabase, com agenda pública/admin, persistência PostgreSQL, RLS, Super Admin, CRM e fundações de automação/WhatsApp presentes no repositório. O frontend continua concentrado principalmente em `app.js` e não há `package.json` no repositório atual.

Palazzo é o tenant real de referência e Nayara Lash Designer é o tenant de validação multi-segmento segundo a documentação do projeto. Em produção, `chronasystem.com.br` é exclusivo da plataforma Chrona e `palazzo.chronasystem.com.br` é a URL canônica da Palazzo. O parâmetro `?tenant=<slug>` permanece como fallback fora do domínio principal para tenants sem hostname publicado.

A camada Meta/WhatsApp possui schema, Edge Functions, fila, webhook e estruturas do chatbot, mas a própria documentação vigente ainda exige configuração de segredos, validação real do webhook, aprovação/vinculação de templates e implementação do processador da máquina de estados antes do piloto. Portanto não considerar o chatbot operacional em produção.

## Funcionalidades

| Funcionalidade | Estado | Evidência/observação |
| --- | --- | --- |
| Núcleo multi-tenant com `barbershop_id` e RLS | IMPLEMENTADO | Migrations criam entidades, políticas e helpers de isolamento. |
| Catálogo público de serviços/profissionais | IMPLEMENTADO | RPC pública e frontend carregam dados por tenant. |
| Disponibilidade e bloqueio de conflito de agenda | VALIDADO | RPC de slots + constraint de não sobreposição; teste remoto confirmou que slots passados no fuso `America/Sao_Paulo` não são retornados. |
| Criação pública de agendamento | VALIDADO | UI filtra datas/horários passados e a RPC revalida horário futuro e disponibilidade completa antes do insert; tentativa remota com data passada foi rejeitada sem criar cliente. |
| Reconhecimento de cliente recorrente | VALIDADO | Telefone é a identidade canônica por tenant, a busca pública reaproveita o cadastro e `localStorage` guarda apenas conveniência do aparelho; teste remoto confirmou lookup existente e ausência de duplicação de teste. |
| Identidade global do consumidor Chrona | EM IMPLEMENTAÇÃO | Schema global vinculado ao usuário Auth, relacionamento `clients` por tenant, consentimentos separados, rate limit e Edge Function Meta foram publicados. A ativação por tenant permanece desligada até existir template OTP aprovado e o Auth Hook ser configurado; o fluxo legado continua operacional nesse intervalo. |
| Área administrativa | IMPLEMENTADO | UI e operações persistentes existem em `app.js`; README lista agenda, clientes, caixa, lembretes, serviços e configurações. |
| Caixa ligado à conclusão de atendimento | IMPLEMENTADO | Estrutura/RPCs versionadas; preservar idempotência. |
| Lembrete/retorno por serviço | IMPLEMENTADO | Migrations e arquitetura definem `return_interval_days` e geração de retorno. |
| Super Admin e gestão de tenants/assinaturas | IMPLEMENTADO | UI, perfis de plataforma, onboarding e controles existem no repositório. |
| Direção visual “Pulso do Tempo” no painel Chrona | PUBLICADO | A plataforma central usa palco escuro preto/vermelho/laranja e superfícies operacionais claras para preservar leitura; o Pages concluiu o deploy do commit `7f9f4c0` e o CSS público foi verificado em `chronasystem.com.br`. |
| Onboarding de tenant + convite do responsável | IMPLEMENTADO | Edge Function autenticada `tenant-onboarding` e RPCs relacionadas. |
| Direção visual automática por tenant | IMPLEMENTADO | `visual_direction` e seleção `editorial`/`studio`/`serene` estão no código/migration. Não equivale à biblioteca de templates avançada discutida futuramente. |
| CRM com pipelines/etapas/oportunidades | IMPLEMENTADO | Schema e CRUD constam do código/documentação. |
| Fila de automações para n8n | IMPLEMENTADO | Edge Function, lease, deduplicação e protocolo documentados. Operação externa contínua não foi comprovada nesta revisão. |
| Conexão Meta Cloud API por tenant | IMPLEMENTADO | Edge Function e schema existem; token é tratado server-side/Vault. Conexão real de cada tenant não foi comprovada nesta revisão. |
| Matriz universal de notificações | IMPLEMENTADO | Regras/seeds e geração estão nas migrations; regras dependentes de Meta nascem inativas. |
| Webhook Meta assinado + tracking de status | IMPLEMENTADO | Edge Function/schema existem. Validação operacional real do callback permanece pendente segundo documentação. |
| Chatbot universal de agendamento | EM IMPLEMENTAÇÃO | Persistência, estados, outbox, webhook e configuração existem, mas `ARCHITECTURE.md` ainda manda implementar o processador da máquina de estados e ativar piloto. |
| Hostname dedicado Palazzo no frontend | PUBLICADO | `chronasystem.com.br` limpa o parâmetro legado e exibe somente a plataforma; Palazzo abre diretamente em `palazzo.chronasystem.com.br`. Links internos, onboarding e retorno ao site usam a URL canônica, conferida no HTTPS após o deploy `60c68d1`. |
| Biblioteca controlada de landing pages | VALIDADO | Renderer único em `site-engine.js`, quatro templates, oito paletas, cinco pares tipográficos, variantes allowlisted, seções ordenáveis/ocultáveis e preview do Admin. Palazzo usa Luxury e Nayara usa Clean por dados, sem fork por tenant. |
| Rascunho e publicação do site | VALIDADO | `tenant_site_configs` mantém `draft_config` e `published_config`; leitura pública expõe somente o publicado. RLS permite leitura ao membro e escrita somente a owner/platform admin. |
| Fontes selecionáveis por cliente | IMPLEMENTADO | Cinco pares curados são selecionáveis no editor; não há CSS arbitrário nem upload de fontes externas. |
| Mídia pública da landing | VALIDADO | Bucket `tenant-site-media` público para leitura, limitado a JPG de 5 MB; upload autenticado restrito a owner/platform admin e à pasta UUID do tenant. Editor aceita logo, hero, fotos opcionais por serviço e até 12 trabalhos recentes. |
| Vitrine de trabalhos recentes | PUBLICADO | Editor universal aceita até 12 JPGs por tenant; a seção nasce habilitada, não renderiza vazia, possui card rotativo e carrossel manual/automático a cada 5 s com volta contínua ao início. Banco, renderer e ciclo infinito foram testados; nenhum tenant possui fotos publicadas para um teste visual real de upload nesta revisão. |
| Subdomínio automático `cliente.chronasystems.com.br` | PLANEJADO | Não encontrada infraestrutura de provisionamento wildcard/subdomínio no repositório atual. |

## Integrações

| Integração | Estado | Situação atual |
| --- | --- | --- |
| Supabase/PostgreSQL/Auth/RLS | IMPLEMENTADO | É a persistência e camada de segurança principal. Projeto configurado em `supabase/config.toml`. |
| GitHub Pages | IMPLEMENTADO | Workflow publica a raiz em pushes para `main`; esta revisão não usa a mera existência do workflow como prova de deploy atual bem-sucedido. |
| Palazzo / hostname dedicado | PUBLICADO | GitHub Pages publicou o commit `96d4219`; o domínio principal com query e o subdomínio dedicado responderam com paridade funcional/visual. |
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
- O hostname canônico da Palazzo está em allowlist no frontend; não existe ainda provisionamento genérico de domínio/subdomínio por tenant no código inspecionado.
- A autenticação global por WhatsApp OTP permanece desligada: a Meta está conectada para Palazzo, mas não existe template OTP aprovado/configurado nem Auth Hook ativo.
- O histórico de migrations remoto contém versões/recursos posteriores ausentes no Git (`20260919181325` a `20260919181521`) e timestamps divergentes em migrations de 12/09. As migrations `20260919235925`, `20260920004315` e `20260920012106` foram aplicadas e registradas isoladamente; não reparar nem forçar o restante sem reconciliar a origem dessas versões.
- README descreve várias capacidades como funcionalidades; agentes devem confirmar cada uma contra código/migrations antes de elevar seu estado para VALIDADO/PUBLICADO.

## Última alteração relevante

Em 20/09/2026, o deploy `60c68d1` publicou a separação entre domínio Chrona e subdomínio Palazzo, hero centralizado, serviços alinhados, quatro diferenciais e galeria universal. As migrations relacionadas foram aplicadas e registradas; o ciclo de 5 s com retorno contínuo foi testado. O envio OTP permanece deliberadamente inativo até a aprovação/configuração do template Meta.

## Próximo incremento recomendado

Antes de iniciar novas funcionalidades, verificar o ambiente real da integração Meta e fechar o ponto já aberto pela arquitetura: segredos/callback/templates e processador da máquina de estados do chatbot, com piloto controlado e evidência funcional antes de marcar como VALIDADO.

O próximo incremento da landing pode adicionar recorte/compressão de imagem no navegador e legendas individuais, sem abrir CSS arbitrário nem atravessar o Chrona Core.

## Não fazer

- Não transformar a biblioteca controlada de landing em editor livre, CSS arbitrário ou fork por tenant.
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
