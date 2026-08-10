# Estado atual — Pane&Salute ERP

**Data de referência:** 2026-08-07

**Base observada:** `origin/main` em `9646e2b`, até a incorporação da PR `#202`

**Natureza:** mapa operacional. Atualizar somente após mudança material
incorporada à `main`.

## Fase estratégica

O projeto está em estabilização e conclusão da Sprint 0 de segurança.

**Decisão de 2026-08-07 — o bloqueio anterior foi substituído.** Até esta data
valia a regra "funcionalidade nova com dado financeiro espera a conclusão do
hardening Auth/RLS". Ela foi revista por Rodrigo depois de duas revisões
independentes (Claude e Sol/Codex) apoiadas em auditoria live somente leitura:

- nenhuma tabela do ERP está exposta ao papel `anon`; as 4 expostas são do
  ControlePizza, risco legado já aceito;
- exposição GraphQL ao papel `authenticated` não contorna RLS;
- as funções `SECURITY DEFINER` listadas são as ações do próprio aplicativo.

O hardening continua e passa a correr **em paralelo**, sem travar o roadmap.
No lugar do bloqueio geral, cada funcionalidade que criar tabela financeira
carrega um **gate técnico próprio**, definido no documento da funcionalidade —
ver o gate da fase 2 em [CONTAS_A_RECEBER.md](CONTAS_A_RECEBER.md).

Ordem de prioridade acordada para o hardening restante: proteção de senha
vazada (concluída), revisão das funções privilegiadas, exposição GraphQL.

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
- o CI executa uma baseline de navegador no Google Chrome contra contas
  fictícias do Banco Preview: pessoa sem sessão, administrador em Sobras com
  JC/JA, Cozinha JC permitida e Vendas JA bloqueada da Produção da Cozinha.
  A senha fica somente no secret do GitHub; screenshots, vídeos e traces estão
  desligados.

## Permissões — três níveis que precisam concordar

1. **`allowed_routes` em `app_profiles`** — ainda decide menu e guarda das
   rotas antigas no cliente (`src/lib/auth.ts`). Perfil sem `allowed_routes`
   recebe defaults por role definidos no código. Exceções já unificadas:
   `/pedidos-pj` deriva da permissão granular `pedidos_pj.acessar` e
   `/producao-cozinha` deriva de `producao_cozinha.lancar`.
2. **`app_permissions` + `app_user_permissions`** — catálogo e concessões
   granulares por usuário, com escopo por loja (`*`, `jc`, `ja`, `ex`).
   Hoje governam as ações do Romaneio, o acesso e a confirmação de envio de
   Pedidos PJ e a Produção da Cozinha por loja via RPCs
   (`replace_user_permissions`, `confirm_pj_order_dispatch`,
   `confirm_romaneio_departure`, `confirm_romaneio_receipt`,
   `approve_romaneio_divergence`, `record_kitchen_batches`,
   `correct_kitchen_batch`, `cancel_kitchen_batch`). Administradas pela tela
   de gestão de acessos.
3. **Policies RLS** — a autorização efetiva do acesso direto às tabelas. As
   ações do Romaneio passam por RPCs `SECURITY DEFINER` com validação interna
   e grants `EXECUTE` próprios — proteção adicional que também precisa de
   revisão em mudança de acesso.

**Risco central:** fora de Pedidos PJ e Produção da Cozinha, os níveis 1 e 2
não são sincronizados. O backfill da migration `20260718181203` derivou
permissões de `allowed_routes` uma única vez; desde então a tela administrativa
escreve somente `app_user_permissions`, enquanto menu e guarda das demais rotas
continuam lendo `allowed_routes`. Alterar acesso em um nível não altera o outro
— causa provável de "usuário perdeu a tela". Mudança de acesso deve verificar
os três níveis até essa unificação ser concluída para os módulos restantes.

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
- recebimento do Romaneio com bloqueio de payload vazio, parcial, duplicado
  ou com quantidade aceita maior que recebida.
- fila segura e confirmação de envio de Pedidos PJ pela Expedição JC; a
  migration está aplicada em produção e a matriz permitida/bloqueada passou no
  banco e no preview; o frontend foi incorporado à `main` pelo PR 149.

Riscos ainda abertos:

- a auditoria live somente leitura de 2026-07-28 confirmou melhora material:
  todas as tabelas públicas auditadas estão com RLS ligado e não há policies
  `anon` permissivas; os grants `anon` do ControlePizza ficam como risco legado
  aceito até a desativação desse sistema; Sprint 0 ainda não fecha para o ERP
  porque restam exposição GraphQL relevante ao ERP e funções `SECURITY DEFINER`
  chamáveis por usuários logados;
- **a proteção contra senha vazada foi ligada em 2026-08-07** e o aviso
  correspondente saiu dos advisors do projeto de produção, verificado por
  leitura após a mudança. Ligada somente em produção; se um dia for ligada no
  `PaneERP Preview`, a senha das contas fictícias precisa não constar da base
  de senhas vazadas, sob pena de quebrar a esteira que recria essas contas;
- `create_manual_payable` aceita `p_paid = true` validando apenas
  `contas_pagar.lancar`, sem exigir `contas_pagar.baixar`. Quem lança consegue
  criar conta já quitada. Achado do Sol em 2026-08-07, ainda aberto, com
  correção prevista em tarefa própria de contas a pagar;
- a tela administrativa permite conceder `romaneio.administrar` por loja,
  mas a entrada do painel administrativo do Romaneio exige escopo `*` —
  concessão por loja não abre o painel;
- o token do bot Telegram ainda é usado no frontend com prefixo
  `NEXT_PUBLIC_`;
- o `npm audit --omit=dev` ainda sinaliza o PostCSS e o Sharp transitivos do
  Next.js 15.5.21. O app estático não processa CSS nem imagens enviados por
  usuários, portanto os caminhos descritos pelos avisos não são alcançáveis
  hoje. Não forçar versões internas fora do intervalo suportado pelo Next;
  reabrir quando houver backport oficial compatível ou se o ERP passar a
  processar CSS/imagem não confiável;
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

Em 2026-07-28, Rodrigo decidiu não investir hardening no ControlePizza, porque
essa parte será desativada em breve e não estará no projeto final. Até a
desativação, os grants legados `anon` em `pizza_*` são risco aceito: não mexer
neles sem nova decisão explícita e não criar dependência nova do ERP sobre essas
tabelas.

## Capacidades já presentes

- produção, forno e confirmação por lotes, com contexto por loja;
- produção da Cozinha registrada em lotes conforme a demanda e resumo diário
  por produto; o banco já possui ações protegidas de correção e cancelamento,
  mas a interface dessas ações ainda não foi implementada;
- sobras, reaproveitamento e pendências com encaminhamento à Central de
  Pendências;
- romaneio com permissões granulares por ação e loja (ressalvas registradas
  em Riscos ainda abertos);
- estoques e fornecedores;
- clientes, pedidos PJ e encomendas; o Banco Preview passou a ter cenário
  comercial de PJ (clientes, tabela de preço e pedidos em aberto, por quilo,
  enviado e cancelado), o que tornou Pedidos PJ e o relatório de Vendas PJ
  testáveis antes de ir ao ar;
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

1. A baseline de navegador cobre o núcleo de Auth e acesso, mas a matriz dos
   módulos operacionais ainda precisa crescer progressivamente conforme cada
   fluxo for estabilizado.
2. Exposição GraphQL de objetos do schema público que seguem vivos no ERP.
   ControlePizza/`pizza_*` é exceção legada aceita até desativação.
3. RLS não pode ser declarado concluído sem resolver os achados da auditoria
   live de 2026-07-28 no escopo do ERP: GraphQL e funções privilegiadas. A
   configuração de senha vazada saiu desta lista em 2026-08-07. Este bloqueio
   deixou de travar funcionalidade nova — ver a decisão em Fase estratégica.
4. Os planos de permissão (`allowed_routes` × `app_user_permissions`) ainda não
   são sincronizados nos módulos antigos; Pedidos PJ já usa a permissão
   granular para menu e rota.
5. O smoke de navegador falha de forma intermitente por causas de ambiente, não
   de código: login logo após a recriação das contas fictícias, e o cenário da
   Geolar, que ainda oscila depois do PR #199. Duas causas já foram corrigidas
   (PRs #199 e #203). Enquanto restarem, o semáforo segura entregas sem
   relação com a falha.

## Próximas fases aprovadas

1. Ampliar a matriz de navegador somente nos módulos tocados por cada lote.
2. Priorizar regressões reproduzíveis.
3. Aplicar o hardening Auth/RLS em lotes pequenos nas próximas tabelas
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
