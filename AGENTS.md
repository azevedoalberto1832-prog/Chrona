# AGENTS.md — Regras permanentes da Chrona

## Objetivo do projeto

Chrona é um SaaS multi-tenant de agendamento e gestão para negócios que atendem por horário. O mesmo código e banco atendem múltiplos estabelecimentos, mantendo identidade, dados e operação isolados por tenant. Palazzo é o tenant real de referência; Nayara Lash Designer existe como tenant de validação multi-segmento.

## Stack e arquitetura atual

- Frontend estático em HTML, CSS e JavaScript vanilla: `index.html`, `styles.css`, `app.js` e `admin-sync.js`.
- Não há `package.json` no estado atual do repositório. Não presumir framework, bundler ou gerenciador de pacotes no frontend.
- Persistência, autenticação, PostgreSQL, RLS, RPCs e Edge Functions usam Supabase.
- Banco único multi-tenant. A chave operacional de isolamento é `barbershop_id`.
- O tenant público é resolvido por slug (`?tenant=<slug>`) e pode também ser resolvido por hostname explicitamente mapeado no frontend.
- GitHub Pages possui workflow de deploy em `.github/workflows/pages.yml` para pushes em `main`.
- Edge Functions existentes: `tenant-onboarding`, `automation-queue`, `whatsapp-connection`, `whatsapp-send` e `whatsapp-webhook`.
- Integrações preparadas/implementadas no código: Meta WhatsApp Cloud API e fila externa para n8n. A existência do código não prova configuração, validação ou operação em produção.

## Organização principal do código

- `app.js`: aplicação web principal. Atualmente concentra resolução do tenant, UI pública, autenticação/admin, Super Admin, CRM, agenda, configurações e chamadas ao Supabase.
- `styles.css`: estilos globais, tenant e áreas administrativas.
- `index.html`: entrada estática.
- `admin-sync.js`: sincronização auxiliar da área administrativa.
- `supabase/migrations/`: fonte versionada da evolução do schema, políticas, RPCs, seeds e regras de automação.
- `supabase/functions/`: integrações privilegiadas e endpoints server-side.
- `docs/`: documentação específica de Meta, lembretes, chatbot e n8n.
- `ARCHITECTURE.md`: responsabilidades e arquitetura de CRM/automações. Pode conter próximos passos; não tratar esses trechos como estado executado.
- `README.md`: visão funcional do produto. Confirmar alegações relevantes contra código/migrations antes de alterar o sistema.
- `PROJECT_STATE.md`: memória operacional viva e fonte de continuidade entre agentes.

## Regras de negócio críticas

- Agenda é a fonte da verdade dos atendimentos.
- CRM organiza relacionamento e próximas ações; não deve criar uma segunda fonte de clientes/agendamentos.
- WhatsApp é canal de comunicação, não fonte de verdade operacional.
- Cada entidade comercial deve respeitar o isolamento do tenant. Não remover ou contornar `barbershop_id`/RLS para simplificar uma implementação.
- Agendamentos `scheduled`/`confirmed` não podem sobrepor horários do mesmo profissional; o banco possui restrição para isso.
- A página pública e criação de agendamento só operam para tenant ativo com assinatura elegível conforme as RPCs vigentes.
- Conclusão de atendimento e efeitos financeiros/retorno devem preservar idempotência definida no banco.
- Automações devem ser deduplicáveis. O consumo da fila usa lease e limite de tentativas.
- Regras universais de WhatsApp nascem inativas quando dependem de configuração externa. Não ativar mensagens antes de conexão, consentimento e template aprovados.
- O chatbot universal nasce desativado por tenant e não deve responder antes da ativação operacional controlada.
- Planos aceitos pelo onboarding atual: `essential` e `pro`.

## Integrações e segurança

- Nunca colocar service-role/secret key, token Meta, segredo de webhook ou `CHRONA_N8N_KEY` no frontend ou no Git.
- Token permanente da Meta deve permanecer server-side e, conforme arquitetura atual, ser referenciado via Supabase Vault.
- `tenant-onboarding` e `whatsapp-connection` exigem JWT conforme `supabase/config.toml`.
- `automation-queue`, `whatsapp-send` e `whatsapp-webhook` não dependem do JWT padrão; sua segurança é implementada pelos próprios protocolos/segredos. Não remover essas verificações.
- Webhook Meta deve preservar validação HMAC e token de verificação.
- Respeitar `whatsapp_opt_in`, opt-out, janela aplicável do WhatsApp e uso de templates aprovados.
- A credencial do n8n é server-side. O n8n não deve receber token Meta do tenant nem acesso irrestrito às tabelas.
- Acesso do Super Admin a painel de tenant é modo de suporte/verificação e deve manter trilha de auditoria em `platform_support_access_logs`.
- Não enfraquecer RLS para resolver problema de frontend. Corrigir política/RPC/fluxo no limite apropriado.

## Limites entre módulos

- UI/identidade do tenant não deve alterar regras de agenda, segurança, billing, RLS ou integrações.
- CRM não substitui agenda nem cadastro canônico de clientes.
- n8n orquestra execuções externas; regras de elegibilidade, isolamento, deduplicação e segredos permanecem na Chrona/Supabase.
- Meta é transporte. Estado de mensagens, fila e resultados devem permanecer persistidos na Chrona.
- Super Admin pode administrar/verificar tenants somente pelos mecanismos autorizados; não criar atalhos que transformem suporte em bypass silencioso.
- Customização visual futura deve preservar um Core comum. Não criar forks de backend por tenant sem decisão arquitetural explícita.

## Comportamentos que não podem ser alterados incidentalmente

- Isolamento multi-tenant e políticas RLS.
- Bloqueio de conflito de agenda.
- Controle de assinatura que protege operação pública.
- Idempotência de caixa, retornos, fila e mensagens.
- Consentimento/opt-out do WhatsApp.
- Segredos somente server-side.
- Auditoria de acesso do Super Admin.
- Tenant público deve continuar carregando dados do tenant correto.
- Alterações visuais não podem mudar dados ou regras de outro tenant.

## Convenções

- Antes de criar nova migration, ler migrations anteriores relacionadas e preservar compatibilidade.
- Mudanças de schema devem ser versionadas em `supabase/migrations/`; não documentar schema desejado como se já existisse.
- Preferir RPC/Edge Function para operações privilegiadas ou invariantes que não podem depender do navegador.
- Estados operacionais em documentação usam somente: `PLANEJADO`, `EM IMPLEMENTAÇÃO`, `IMPLEMENTADO`, `VALIDADO`, `PUBLICADO`, `BLOQUEADO`.
- `IMPLEMENTADO` significa evidência no repositório. Não implica teste real nem deploy.
- `VALIDADO` exige evidência de teste funcional relevante, não apenas build/compilação.
- `PUBLICADO` exige confirmação real de deploy/publicação, não apenas workflow/configuração existente.

## PROTOCOLO DE INÍCIO

Antes de modificar código:

1. Ler AGENTS.md.
2. Ler PROJECT_STATE.md.
3. Inspecionar o código relacionado à tarefa.
4. Conferir o estado real antes de assumir qualquer coisa.
5. Preservar funcionalidades não relacionadas.
6. Não reabrir problemas resolvidos sem evidência técnica de regressão.
7. Não tratar planejamento documentado como funcionalidade implementada.

## PROTOCOLO DE CONCLUSÃO

Toda alteração funcional deve terminar com revisão do `PROJECT_STATE.md`.

O agente deve registrar apenas fatos comprovados.

Diferenciar obrigatoriamente:

- PLANEJADO
- EM IMPLEMENTAÇÃO
- IMPLEMENTADO
- VALIDADO
- PUBLICADO
- BLOQUEADO

Nunca marcar algo como VALIDADO apenas porque o código compilou.

Nunca marcar como PUBLICADO sem confirmação real de deploy/publicação.

A atualização do `PROJECT_STATE.md` faz parte da definição de conclusão da tarefa.

Se houve alteração funcional relevante e o estado não foi atualizado, a tarefa não está concluída.

## Instruções para agentes futuros

- Trate `AGENTS.md` + `PROJECT_STATE.md` como leitura obrigatória em toda nova tarefa.
- Para qualquer afirmação de estado, prefira código, migration, configuração e evidência operacional atual a planos de conversas anteriores.
- Commits e documentação explicam intenção, mas não substituem inspeção do estado atual.
- Não implemente escopo adjacente sem solicitação. Mudança pequena não é licença para reforma geral.
- Se documentação e código divergirem, registre a divergência e use o código/migration como evidência do que existe; não invente reconciliação.
- Após mudança funcional relevante, atualize `PROJECT_STATE.md` de forma curta, removendo fatos obsoletos em vez de acumular diário histórico.
- `AGENTS.md` deve mudar pouco, somente quando arquitetura, regras permanentes ou este protocolo realmente mudarem.
