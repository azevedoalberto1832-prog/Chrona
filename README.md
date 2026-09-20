# Chrona — SaaS multi-tenant de agendamento

**Chrona** é uma plataforma única de agendamento e gestão para negócios que trabalham com atendimento por horário.

A **PALAZZO STUDIO BARBER** é o primeiro tenant real e a **Nayara Lash Designer** é o tenant fictício de validação multi-segmento. Cada identidade permanece na página pública, enquanto infraestrutura, autenticação, planos e administração pertencem à Chrona.

## Funcionalidades

- Catálogo público de serviços e contato por WhatsApp.
- Agendamento autônomo em quatro passos, com soma de preço/duração e bloqueio de conflitos.
- Área administrativa responsiva: dashboard, agenda, clientes, caixa, lembretes, serviços e configurações.
- Lembretes de aniversário e retorno com período configurável por serviço e padrão de 20 dias.
- Persistência operacional no Supabase/PostgreSQL; o navegador não é a fonte da verdade.
- Autenticação administrativa, isolamento multi-tenant por RLS e controle de assinatura.
- Conclusão de atendimento com lançamento idempotente no caixa.
- CRUD persistente de clientes, serviços, profissionais, movimentações e configurações.
- Super Admin Chrona para gestão central de tenants, planos, trials e suspensão.
- CRM multi-tenant com pipelines, etapas, oportunidades, próximas ações e acompanhamento de ganhos e perdas.
- Conclusão do atendimento agenda automaticamente o próximo retorno conforme os serviços realizados.
- Fila de automações com consumo autenticado pelo n8n, lease transacional e proteção contra duplicidade.
- Integração com Meta Cloud API v26.0, token por tenant criptografado no Supabase Vault e envio restrito a templates aprovados.
- Chatbot universal de agendamento replicado por tenant, com estado isolado, fila idempotente, opt-out, fallback e encaminhamento humano.
- Modo de verificação do Super Admin para acessar qualquer painel com a conta central da Chrona e registro de auditoria.

## Arquitetura e evolução

A aplicação usa um único banco multi-tenant no Supabase. Cada registro operacional pertence a um estabelecimento e as políticas RLS aplicam o isolamento no banco. O tenant público é selecionado por `?tenant=<slug>`; o Palazzo também é resolvido pelo hostname `palazzo.chronasystem.com.br`. Palazzo e Nayara usam o mesmo código e dados isolados. A fundação de CRM e automações está documentada em `ARCHITECTURE.md`; o chatbot universal está detalhado em `docs/WHATSAPP_CHATBOT.md` e permanece desativado até a conexão oficial de cada tenant.

## Execução local

Sirva a pasta com qualquer servidor HTTP estático, por exemplo `npx serve .`.
