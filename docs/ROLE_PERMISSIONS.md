# Matriz de permissões operacionais

Decisão de produto: cada usuário operacional pertence a exatamente um tenant. Um tenant pode possuir vários profissionais. Somente `platform_admin` possui acesso transversal, sempre pelo fluxo de suporte auditado.

Esta matriz é o contrato para a próxima migration de RLS. Ela não deve ser implementada parcialmente sem fixtures de teste para todos os papéis.

| Recurso | Owner | Recepção | Profissional | Super Admin |
| --- | --- | --- | --- | --- |
| Dados e identidade do tenant | Ler e editar | Ler | Ler dados não sensíveis | Ler e editar em suporte auditado |
| Perfis e papéis | Gerenciar | Ver equipe | Ver o próprio perfil e diretório mínimo | Gerenciar em suporte auditado |
| Profissionais | Gerenciar | Ver | Ver o próprio cadastro e diretório mínimo | Gerenciar em suporte auditado |
| Serviços | Gerenciar | Ver | Ver | Gerenciar em suporte auditado |
| Horários da empresa | Gerenciar | Ver | Ver | Gerenciar em suporte auditado |
| Exceções/bloqueios | Gerenciar todos | Gerenciar todos | Gerenciar apenas os próprios | Gerenciar em suporte auditado |
| Agenda | Gerenciar todos | Gerenciar todos | Ver e atualizar apenas os próprios atendimentos | Gerenciar em suporte auditado |
| Clientes | Gerenciar | Gerenciar | Ver somente clientes vinculados aos próprios atendimentos | Gerenciar em suporte auditado |
| Caixa | Gerenciar | Registrar e consultar | Sem acesso por padrão | Gerenciar em suporte auditado |
| Lembretes Essential | Gerenciar | Gerenciar | Sem acesso por padrão | Gerenciar em suporte auditado |
| CRM, pipelines e automações Pro | Gerenciar | Operar quando autorizado pelo plano | Sem acesso por padrão | Gerenciar em suporte auditado |
| Configuração de IA/WhatsApp | Gerenciar | Sem acesso | Sem acesso | Gerenciar em suporte auditado |
| Assinatura e plano | Ver | Sem acesso | Sem acesso | Gerenciar |
| Site, logo e mídia | Gerenciar | Sem acesso | Sem acesso | Gerenciar em suporte auditado |

## Regras técnicas

- A UI nunca é a fronteira de segurança; RLS/RPC deve aplicar a matriz.
- O papel `platform_admin` não recebe um `barbershop_id`; seu acesso transversal continua explícito e auditado.
- Um perfil `barber` deve estar ligado a `professionals.profile_id` no mesmo tenant antes de acessar agenda própria.
- Operações públicas de agendamento continuam passando apenas pelas RPCs públicas validadas.
- Recursos Pro exigem capability ativa no backend, além do papel permitido.
- Nenhuma policy de escrita deve usar apenas `private.is_tenant_member` quando a ação for exclusiva de owner/recepção.

## Casos mínimos de teste

1. Owner A não lê nem altera tenant B.
2. Recepção A gerencia agenda/clientes/caixa de A e não altera configurações, plano, site ou integrações.
3. Profissional A vê/atualiza apenas os próprios atendimentos e bloqueios.
4. Profissional A não lê caixa, CRM, automações, configurações ou clientes sem atendimento próprio.
5. Super Admin acessa A e B somente com perfil de plataforma ativo; entrada no suporte gera log.
6. Usuário inativo não acessa o tenant.
7. Essential não acessa capabilities Pro, independentemente do papel.

