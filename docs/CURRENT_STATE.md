# Estado atual — Pane&Salute ERP

**Data de referência:** 2026-07-22

**Base observada:** `origin/main` no commit `7fcd9aa`, mais o pacote do processo confiável (baseline do banco, CI e Actions)

**Natureza:** mapa operacional. Atualizar somente após mudança material
incorporada à `main`.

## Fase estratégica

O projeto está em estabilização e conclusão da Sprint 0 de segurança.

Funcionalidades novas que adicionem dados financeiros devem esperar:

1. baseline de testes e navegador no `main`;
2. conclusão da auditoria e do hardening Auth/RLS.

## Autenticação

Estado conhecido:

- Supabase Auth por e-mail e senha é o único acesso; o login por PIN foi
  removido do aplicativo e a migration aplicada em produção — `app_users` não
  tem mais policy nem privilégios para `PUBLIC`, `anon` ou `authenticated`;
- `app_profiles` fornece role, loja, rotas e status do usuário autenticado;
- recuperação e definição de senha existem;
- criação e desativação de contas ocorrem no Supabase Auth pelo administrador;
  a gestão de permissões granulares tem tela administrativa própria no app;
- `app_users` e a coluna histórica de PIN permanecem no banco apenas para
  rollback administrativo controlado, sem exposição pela Data API.

## Permissões — três níveis que precisam concordar

1. **`allowed_routes` em `app_profiles`** — ainda decide menu e guarda das
   rotas antigas no cliente (`src/lib/auth.ts`). Perfil sem `allowed_routes`
   recebe defaults por role definidos no código. Exceção já unificada:
   `/pedidos-pj` deriva da permissão granular `pedidos_pj.acessar`.
2. **`app_permissions` + `app_user_permissions`** — catálogo e concessões
   granulares por usuário, com escopo por loja (`*`, `jc`, `ja`, `ex`).
   Hoje governam as ações do Romaneio, o acesso e a confirmação de envio de Pedidos PJ
   via RPCs (`replace_user_permissions`, `confirm_pj_order_dispatch`,
   `confirm_romaneio_departure`, `confirm_romaneio_receipt`,
   `approve_romaneio_divergence`). Administradas pela tela de gestão de
   acessos.
3. **Policies RLS** — a autorização efetiva do acesso direto às tabelas. As
   ações do Romaneio passam por RPCs `SECURITY DEFINER` com validação interna
   e grants `EXECUTE` próprios — proteção adicional que também precisa de
   revisão em mudança de acesso.

**Risco central:** fora de Pedidos PJ, os níveis 1 e 2 não são sincronizados. O backfill da
migration `20260718181203` derivou permissões de `allowed_routes` uma única
vez; desde então a tela administrativa escreve somente `app_user_permissions`,
enquanto menu e guarda das demais rotas continuam lendo `allowed_routes`.
Alterar acesso em um nível não altera o outro — causa provável de "usuário
perdeu a tela". Mudança de acesso deve verificar os três níveis até essa
unificação ser concluída para os módulos restantes.

## RLS e Supabase

Hardening versionado na `main` (aplicação em produção só é considerada
confirmada onde existe registro correspondente em `docs/history/` ou
auditoria live):

- `app_profiles`, `app_permissions`, `app_user_permissions`;
- tabelas iniciais de estoque;
- clientes e tabelas de preço;
- acesso autenticado a pedidos, incluindo produção por loja para `vendas`;
- policies autenticadas de componentes de ficha;
- fechamento de caixa;
- funções do Romaneio com permissões granulares.
- fila segura e confirmação de envio de Pedidos PJ pela Expedição JC; a
  migration está aplicada em produção e a matriz permitida/bloqueada passou no
  banco e no preview; o frontend foi incorporado à `main` pelo PR 149.

Riscos ainda abertos:

- o último inventário live completo registrou tabelas sem RLS e policies
  anônimas permissivas; o estado live precisa ser reauditado antes de
  declarar Sprint 0 concluída;
- as migrations de permissões de 2026-07-18 não têm registro de aplicação em
  produção; confirmar antes de assumir vigência;
- `confirm_romaneio_receipt` aceita payload vazio ou parcial e ainda assim
  pode fechar o romaneio como `conferido` (migration `20260718203439`);
- a tela administrativa permite conceder `romaneio.administrar` por loja,
  mas a entrada do painel administrativo do Romaneio exige escopo `*` —
  concessão por loja não abre o painel;
- o token do bot Telegram ainda é usado no frontend com prefixo
  `NEXT_PUBLIC_`;
- `src/lib/database.types.ts` está obsoleto (ainda descreve `app_users`, não
  contém `app_profiles`, `app_permissions`, `app_user_permissions` nem
  `cash_closings`) e o cliente Supabase nem o utiliza;
- o TypeScript aceita o role `romaneio`, mas a constraint de `app_profiles`
  no schema versionado não o inclui.

Não deduza o estado de produção apenas pelas migrations locais. Para tarefa de
segurança, compare migration, resultado documentado, código cliente e auditoria
live somente leitura.

O projeto Supabase também atende o sistema `ControlePizza`. Desde o baseline
de 2026-07-22, este repositório é o único dono da história de migrations do
projeto compartilhado: o baseline inclui os objetos do ControlePizza, e
qualquer mudança de schema — do ERP ou do ControlePizza — entra por PR aqui
e é aplicada pela Action. O repositório ControlePizza não aplica schema
(regra em AGENTS.md, seção Deploy e produção).

## Capacidades já presentes

- produção, forno e confirmação por lotes, com contexto por loja;
- sobras, reaproveitamento e pendências com encaminhamento à Central de
  Pendências;
- romaneio com permissões granulares por ação e loja (ressalvas registradas
  em Riscos ainda abertos);
- estoques e fornecedores;
- clientes, pedidos PJ e encomendas;
- tabelas e opções de preço;
- fechamento de caixa;
- catálogo unificado com `products.kind`;
- componentes de ficha técnica, rendimentos e cálculo de CMV;
- auditoria de cobertura/qualidade do CMV;
- relatórios operacionais;
- gestão administrativa de permissões por usuário;
- layout responsivo para desktop além do mobile.

## Capacidades parciais

### Compras e cotações legadas

As rotas `/compras` e `/cotacoes` estão temporariamente pausadas enquanto o
fluxo e a necessidade operacional são reavaliados. Os dados históricos foram
preservados e as tabelas legadas ficaram sem acesso pela Data API.

Essa pausa não cancela a frente estratégica de compras por XML prevista no
plano de CMV.

### Ficha técnica e CMV

Existem componentes, rendimentos, opções de venda e cálculo teórico. Ainda não
há ficha versionada completa nem cobertura suficiente para declarar CMV
confiável.

### CNM

Há trabalhos de leitura XLS e coleta autorizada por navegador. Isso não
equivale a uma importação consolidada, validada e integrada ao ERP.

### Sobras

O fluxo por lotes e reaproveitamento avançou. Custos, motivos padronizados,
rupturas e indicadores comparáveis ainda precisam ser consolidados.

## Bloqueios atuais

1. Muitos branches e worktrees antigos aumentam o risco de partir de base
   desatualizada.
2. Ausência de baseline recente e único no navegador.
3. Policies anônimas permissivas remanescentes em áreas operacionais.
4. RLS não pode ser declarado concluído sem nova auditoria live.
5. Os planos de permissão (`allowed_routes` × `app_user_permissions`) ainda não
   são sincronizados nos módulos antigos; Pedidos PJ já usa a permissão
   granular para menu e rota.

## Próximas fases aprovadas

1. Organizar branches/worktrees sem perder trabalho.
2. Executar baseline técnico e smoke tests no navegador.
3. Priorizar regressões reproduzíveis.
4. Aplicar o hardening Auth/RLS em lotes pequenos nas próximas tabelas
   operacionais, com validação por perfil e loja antes de cada aplicação em
   produção.

Depois disso, seguir [PLAN.md](PLAN.md).

## Como atualizar este arquivo

Atualize somente quando um PR incorporado à `main`:

- concluiu ou iniciou uma fase;
- adicionou ou retirou capacidade relevante;
- abriu ou fechou risco operacional;
- mudou autenticação, RLS ou arquitetura;
- alterou o próximo bloqueio real.

Não adicionar lista de commits, arquivos tocados ou detalhes fáceis de descobrir
no código.
