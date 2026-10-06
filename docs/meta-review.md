# Preparação de avaliação Meta — Chrona Systems

> Estado em 06/10/2026. Este documento não contém credenciais, tokens ou segredos.

## Identificação

- Marca: **Chrona Systems**
- Nome empresarial: **69.470.227 ALBERTO SILVA AZEVEDO JUNIOR**
- CNPJ: **69.470.227/0001-05**
- Município/UF: **Uberlândia/MG**
- E-mail oficial: **azevedo.alberto1832@gmail.com**
- Situação cadastral: ativa desde 05/10/2026, conforme CCMEI apresentado pelo titular.

## Verificações externas concluídas e em andamento

- O domínio `chronasystem.com.br` foi adicionado ao portfólio empresarial e verificado pela Meta por meta tag em 06/10/2026.
- A verificação empresarial de **69.470.227 ALBERTO SILVA AZEVEDO JUNIOR** foi enviada em 06/10/2026 e aparece como **Em análise**.
- A Meta informa prazo aproximado de dois dias úteis para a análise empresarial.
- A comprovação foi aceita pelo domínio verificado; o fluxo não solicitou upload do CCMEI.
- O app `Chrona Systems` (ID `931779682859586`) continua **Não publicado** enquanto a verificação empresarial está pendente.
- A **Verificação do acesso** como provedora de tecnologia permanece desabilitada até a aprovação da empresa; depois de iniciada, a Meta informa análise em aproximadamente cinco dias.

## Produto e uso legítimo do WhatsApp

A Chrona é uma plataforma multi-tenant de agenda, gestão de clientes, CRM, caixa e automações para estabelecimentos que trabalham com atendimento por horário. O caso demonstrável prioritário da WhatsApp Business Platform é operacional: confirmação e lembrete de agendamentos, atendimento solicitado pelo cliente e automações autorizadas. Não existe proposta de disparo indiscriminado ou spam.

## Arquitetura real

```text
Navegador Chrona
  → Supabase Auth, Postgres/RLS e Edge Functions
    → fila/orquestração interna (n8n, quando habilitada)
      → WhatsApp Business Platform
```

- O frontend recebe somente a chave pública/publishable do Supabase.
- Tokens Meta, service role, webhook secret e credenciais do n8n permanecem server-side.
- O n8n é infraestrutura interna; o reviewer não acessa seu painel.
- O webhook valida assinatura e resolve o tenant pelo número conectado.
- A integração existente usa conexão manual segura. A tela foi preparada para receber Embedded Signup, ainda não habilitado.

## URLs públicas

- Landing: `https://chronasystem.com.br/`
- Política: `https://chronasystem.com.br/politica-de-privacidade/`
- Termos: `https://chronasystem.com.br/termos-de-uso/`
- Contato: `https://chronasystem.com.br/contato/`
- Login: `https://chronasystem.com.br/?platform=chrona#admin`
- Integração: após autenticar no tenant autorizado, abrir **Integrações → WhatsApp Business**.

## Fluxo de avaliação previsto

1. Abrir a landing e conferir identidade jurídica e links institucionais.
2. Acessar Política e Termos sem autenticação.
3. Abrir o login do ambiente de avaliação.
4. Autenticar com a conta entregue diretamente à Meta.
5. Entrar no tenant de demonstração com dados fictícios.
6. Abrir **Integrações → WhatsApp Business**.
7. Conferir o estado da conexão e sua finalidade operacional.
8. Quando habilitado, iniciar o Embedded Signup e retornar à Chrona.
9. Demonstrar confirmação ou lembrete com destinatário de teste e consentimento.

## Credenciais do reviewer

Nunca registrar a senha real no repositório. Fornecer as credenciais diretamente no canal seguro da Meta.

```dotenv
META_REVIEW_EMAIL=
META_REVIEW_PASSWORD=
```

## Estratégia de conta e tenant demo

Não foi criada conta ou role fictícia nesta etapa. A arquitetura atual vincula cada perfil operacional a um único tenant e reserva `platform_admin` ao Super Admin. Antes do App Review, criar um tenant dedicado (`Chrona Demo` ou `Meta Review`) com dados sintéticos e uma role restrita equivalente a `meta_reviewer` somente após implementar e testar a matriz de permissões/RLS.

A conta de avaliação deve pertencer somente ao tenant demo; não ser `platform_admin` nem `owner`; não acessar cobrança, gestão de tenants, Supabase, n8n ou segredos; visualizar a integração e executar apenas o fluxo necessário; falhar ao tentar trocar o tenant pela URL; e usar somente dados fictícios.

No estado atual, parte das policies autoriza qualquer membro do tenant. Reutilizar `receptionist` sem endurecimento daria acesso operacional além do necessário. A conta fica bloqueada até a matriz granular ser validada.

## Embedded Signup — pendências reais

- aguardar a aprovação da verificação empresarial e concluir a Verificação do acesso como provedora de tecnologia;
- resolver separadamente a restrição permanente da conta empresarial WhatsApp;
- confirmar App ID, Facebook Login for Business e `config_id` externos;
- cadastrar domínios e redirects de produção;
- criar troca de código server-side sem expor App Secret;
- vincular WABA e número ao tenant correto;
- persistir apenas identificadores apropriados e referência server-side do segredo;
- testar callback, cancelamento, reautorização e isolamento entre dois tenants.

Nenhum App ID, permissão ou credencial foi inventado no frontend.

## Permissões Meta

| Permissão solicitada | Funcionalidade que a utiliza | Evidência |
| --- | --- | --- |
| `whatsapp_business_messaging` | Confirmações, lembretes e atendimento autorizado pelo número do tenant | Chamada de teste concluída na Meta; justificativa salva no App Review em 06/10/2026. |
| `whatsapp_business_management` | Identificação da WABA/número, estado da conexão, templates e webhook autorizados pelo tenant | Chamada de teste concluída; justificativa salva no App Review. |
| `manage_app_solution` | Relação de solução parceira necessária ao cadastro incorporado de empresas clientes | Justificativa salva; ainda falta uma chamada obrigatória de teste. |
| `business_management` | Consulta dos ativos comerciais escolhidos pelo administrador durante o cadastro incorporado | Justificativa salva; ainda falta uma chamada obrigatória de teste. |
| `public_profile` | Identificação básica do administrador no Login do Facebook para Empresas | Duas chamadas de teste registradas; falta confirmar conformidade no formulário. |
| `email` | Identificação/contato do administrador no Login do Facebook para Empresas | Falta confirmar necessidade mínima e conformidade no formulário. |

`whatsapp_business_manage_events` foi removida da solicitação em 06/10/2026. Essa permissão é destinada ao envio de eventos de conversão/publicidade à Meta e não corresponde ao fluxo atual da Chrona. Não readicionar sem uma funcionalidade real, documentação e base de consentimento específicas.

## Segurança revisada

- `barbershop_id` é a fronteira de tenant no banco e nas consultas.
- O perfil associado à sessão resolve o tenant; a URL não concede acesso por si só.
- O suporte do Super Admin é explícito e auditado em `platform_support_access_logs`.
- A conexão valida usuário/papel e guarda a referência do token no Vault.
- A varredura de 05/10/2026 não encontrou valores de segredo versionados; ocorrências de `service_role` eram nomes de variáveis server-side.
- Não foi encontrada URL administrativa do n8n no frontend.

## Bloqueadores antes da avaliação

1. Aguardar a decisão da verificação empresarial enviada em 06/10/2026.
2. Concluir a Verificação do acesso como provedora de tecnologia.
3. Resolver a restrição atual da conta empresarial WhatsApp junto à Meta.
4. Configurar o Embedded Signup real e redirects.
5. Implementar/testar a permissão mínima do reviewer no backend/RLS.
6. Criar tenant demo sintético e entregar credenciais fora do Git.
7. Gravar o fluxo real com número e destinatário de teste.
8. Documentar somente as permissões Meta efetivamente solicitadas.
