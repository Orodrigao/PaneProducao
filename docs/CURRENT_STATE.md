# Estado atual — Pane&Salute ERP

**Data de referência:** 2026-09-23

**Base observada:** `origin/main` em `ed66c21`. A revisão de 11/09/2026 cobriu
a virada da jornada PJ; a atualização de 23/09/2026 incorporou as entregas até
o PR #441; a de 26/09/2026 registrou a trava da `main` e a separação das
regras em `docs/regras/`. As demais seções conservam suas datas de revisão
anteriores.

**Natureza:** mapa operacional. Atualizar somente após mudança material
incorporada à `main`.

## Trava da `main` e equipe de IA (26/09/2026)

- **A `main` está travada no GitHub desde 25/09/2026** pelo ruleset
  `Trava da main` (id 24014339). Conferido por leitura da API do GitHub em
  26/09/2026, feita com permissão de administrador (a lista de exceção só é
  confiável lida assim): ativo, sem ninguém na lista de exceção (nem o dono).
  Recusa apagar a `main` e forçar push nela, exige PR (sem mínimo de
  aprovações) e exige verdes três checks: `Classificar mudança (documental,
  mecanismo de CI ou produto)`, `Verificação (lint, tipos, testes, build)` e
  `Navegador (login, perfis e lojas)`.
- **Lacuna da trava:** `CI Banco`, `Banco por PR` e `Usuarios do Banco por PR`
  não estão entre os checks obrigatórios. Numa PR que mexe em `supabase/`, o
  GitHub deixaria mergear com esses três vermelhos; quem segura hoje é a regra
  do `AGENTS.md` (CI vermelho não mergeia), não a trava. A trava também não
  exige a PR atualizada com a `main` antes do merge
  (`strict_required_status_checks_policy: false`): atualizar a base depois do
  merge de outro agente é regra escrita, não trava.
- **Fechando a lacuna (autorizado pelo Rodrigo em 26/09/2026):** entram na
  trava `Aplicar história completa num banco limpo` (job do `CI Banco`) e
  `Apontar o preview para o banco desta PR` (job do `Banco por PR`). Para isso
  o `CI Banco` passou a rodar em toda PR (o ensaio só quando a PR mexe em
  banco); com o filtro antigo, PR sem banco nunca receberia o check e ficaria
  esperando para sempre. A trava muda só depois que essa mudança estiver na
  `main`; até lá, a lista de três checks acima continua valendo.
  `Usuarios do Banco por PR` fica de fora enquanto puder correr antes de o
  banco da PR ficar pronto (falha observada em 03/09/2026, mais abaixo):
  obrigatório, ele travaria merges por essa corrida.
- **As regras comuns da equipe de IA** — MASTER, protocolo, manuais da
  portaria e de coordenação e as skills de função — vivem no repositório
  `Orodrigao/equipe-ia` e são instaladas na máquina do Rodrigo. Desde esta
  data, o `AGENTS.md` cita papéis e funções, não nomes de fornecedor, e as
  regras de banco, fechamento e arquivos saíram para `docs/regras/`, acionadas
  pela tabela de gatilhos.

## Jornada PJ padrão para novos pedidos (11/09/2026)

As PRs #339, #340 e #341 publicaram a ficha separada em Conferência → Revisão e
NF → Saída, a revisão de vencimentos e parcelas e as exceções de devolução por
Pix e crédito manual. A PR #343, integrada em `34acab5`, abriu a entrada
controlada: Financeiro ou Administrador autorizado escolhe explicitamente um
pedido PJ ainda intacto e somente um pedido real pode usar a jornada por vez.

O banco serializa tentativas simultâneas, registra entrada e retorno e só permite
voltar à rotina anterior antes da primeira conferência ou movimentação
financeira. A migration `20260908233749_ativacao_controlada_fluxo_pj` foi aplicada
pela Action `Banco (migrations)`; site, CI e banco de preview ficaram verdes.

A primeira tentativa real revelou que o seed de teste já concedia
`pedidos_pj.liberar` ao Financeiro, mas a criação da jornada não havia alinhado
os perfis existentes de produção. A PR #346 corrigiu esse cadastro: somente a
Elis recebeu `pedidos_pj.liberar` com escopo JC, porque já era Financeiro ativo,
tinha acesso a Pedidos PJ e podia consultar e lançar Contas a receber. Novos
perfis continuam dependendo de concessão administrativa explícita.
Administradores sem concessão, Vendas e Expedição continuam sem poder iniciar
ou liberar a jornada.

Em 09/09/2026 às 13:12, a Elis inscreveu o pedido da Quinta Parrilla Bar como o
primeiro e único pedido real acompanhado. A consulta somente leitura após a
ativação confirmou a versão inicial: 5 unidades de Italiano, ainda sem quantidade
conferida, cobrança, liberação ou saída. O próximo passo operacional é a
Expedição JC conferir esse pedido; depois, o ciclo segue para revisão financeira
e NF, liberação e saída.

Em 11/09/2026, a PR #380 publicou a gravação atômica e idempotente de criação,
edição e cancelamento, a proteção contra edição simultânea e o gerenciamento do
pedido padrão ainda intacto. A migration
`20260911180134_ativar_rotina_padrao_pedidos_pj` faz a virada sob a mesma trava
usada pela criação: somente pedidos criados após o instante gravado em
`private.pj_flow_rollout_settings.cutover_at` entram automaticamente na jornada
`standard`. Pedidos anteriores permanecem legados, e o pedido controlado da
Quinta Parrilla conserva sua identidade `controlled_real` até concluir o ciclo.

## Fase estratégica

O projeto está em estabilização e conclusão da Sprint 0 de segurança.

**Decisão do Rodrigo, 2026-08-11:** funcionalidade nova com dado financeiro
**pode andar sem esperar o hardening completo**, desde que cumpra o gate
técnico por fase definido nos planos ([CONTAS_A_RECEBER.md](CONTAS_A_RECEBER.md)
e [FINANCEIRO.md](FINANCEIRO.md)): RLS forçado desde a criação, escrita
somente por função protegida, grants explícitos, idempotência e matriz de
teste permitido×bloqueado. Substitui a regra anterior, que exigia a
conclusão da auditoria e do hardening Auth/RLS antes de qualquer dado
financeiro novo. O hardening restante (fechar a exposição GraphQL; a revisão
das funções privilegiadas fechou em 2026-09-23) segue em lotes, em paralelo.

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
   `approve_romaneio_divergence`, `schedule_pj_production`,
   `list_pj_production_queue_v2`, `list_kitchen_production_plan`,
   `record_kitchen_batches`,
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
  aceito até a desativação desse sistema;
- **fechada em 2026-09-23 a revisão das funções `SECURITY DEFINER` chamáveis
  por usuário logado**, pendência da auditoria de 2026-07-28. Leitura direta
  em produção (não deduzida de migration): as 93 funções `SECURITY DEFINER` de
  `public` têm `search_path=""`; as 11 funções `private.*` que as policies RLS
  usam para decidir acesso (`current_user_can_finance`,
  `current_user_can_finance_store`, `current_user_can_payables`,
  `current_user_can_receivables`, `current_user_can_sales`,
  `current_user_has_permission`, `current_user_is_access_admin`,
  `is_pj_flow`, `is_pj_flow_receivable`, `pizza_is_allowed`,
  `pj_flow_commercial`) só liberam acesso a partir de `auth.uid()` contra um
  perfil ativo, nunca para anônimo. As policies que **não** citam identidade
  diretamente (`payable_events`, `payable_installments`,
  `payable_purchase_items`, delegando à policy da compra-mãe) são seguras
  porque o Postgres aplica a RLS da tabela-mãe dentro da subconsulta, e as
  quatro tabelas de Contas a Pagar não têm nenhuma policy de escrita — toda
  gravação passa pelas funções protegidas. As policies do fluxo PJ
  (`orders_pj_flow_read` e semelhantes) são `RESTRICTIVE`: só estreitam
  acesso, nunca abrem. Nenhum defeito encontrado. Achado menor, sem risco:
  `current_user_can_sales` é a única das seis funções de permissão que não
  libera `admin` automaticamente, exige concessão explícita de `vendas.*`;
  **resta só a exposição GraphQL do schema público**, tratada a seguir;
- **exposição GraphQL do schema público, ainda aberta.** Levantamento de
  2026-09-23 (advisor de segurança do próprio Supabase, em produção): `anon` e
  `authenticated` têm permissão para chamar `graphql_public.graphql()`, o que
  expõe 75 tabelas do ERP a qualquer usuário logado e 5 tabelas legadas
  (`pizza_*` e `site_bread_catalog`) a qualquer visitante anônimo pela
  introspecção do GraphQL. A RLS por trás continua valendo (GraphQL usa o
  mesmo papel de banco do REST, não contorna policy), então não é vazamento de
  dado — é superfície destrancada sem uso: o código do site não referencia
  GraphQL em nenhum lugar. Fechamento planejado (fase 1 do item de segurança);
- a proteção contra senha vazada foi confirmada **ligada** em auditoria live
  somente leitura de 2026-08-11 (painel do Supabase, projeto de produção):
  plano Pro ativo na organização, HaveIBeenPwned habilitado e mínimo de 10
  caracteres exigido pelo servidor — alinhado ao `PASSWORD_MIN_LENGTH` do
  app. Isso satisfaz o item 1 do gate técnico dos planos de Contas a Receber
  e Financeiro;
- **corrigida pela PR #423 a separação incompleta entre lançar e baixar
  conta.** `create_manual_payable` aceitava `p_paid = true` e marcava compra e
  parcela como quitadas sem registrar a baixa no livro-caixa. A porta antiga
  passa a aceitar somente conta em aberto, ainda protegida por
  `contas_pagar.lancar`; conta já paga precisa usar a operação completa
  `create_and_pay_manual_payable`, que exige também `contas_pagar.baixar`,
  classifica e registra a baixa no livro. O teste de banco cobre os dois
  perfis, bloqueia a porta incompleta sem gravar e confirma o lançamento no
  livro pelo caminho completo;
- **a entrada de NF-e recusa toda nota em que a soma dos produtos não fecha com
  o valor total.** Relatado por Rodrigo em 2026-09-03: há muitas notas em que
  incide imposto por fora, como ICMS substituição e IPI, ou despesa acessória,
  e nelas o valor da nota é maior que a soma dos produtos. A função
  `create_xml_payable` compara a soma dos itens com o total informado e levanta
  "A soma dos itens da NF-e não fecha com o total informado". Efeito na
  operação: essas notas não entram e a conta a pagar não nasce. Contorno
  existente: lançar a compra à mão somando o imposto como item. **Decisão
  registrada em 2026-09-07:** impostos não recuperáveis e despesas de aquisição
  compõem o custo, sem dupla contagem e sem ratear diferença desconhecida. Ver
  [COMPRAS_POR_XML.md](COMPRAS_POR_XML.md). **Fase 1 no ar desde 2026-09-12
  (PR #386):** o leitor de XML passou a ler o bloco de totais inteiro e a tela
  de importação mostra a composição da nota e explica a recusa antes de a
  pessoa classificar os itens, com a saída (lançar à mão). **Fase 2
  (2026-09-12):** a importação pode ser salva pendente de conferência, sem
  conta a pagar nem custo, retomável e descartável, com gate no banco (tabela
  própria, RLS forçada, mutação só por RPC). **Fase 3A (2026-09-13):** nota
  com ICMS-ST, IPI, frete e outras despesas entra pelo XML, e esses valores
  compõem o custo do insumo sem dupla contagem, com a composição conferida
  campo a campo no banco; o custo do insumo passa a ser o da NF-e mais recente.
  O defeito fica fechado para os casos com nota real de exemplo. Continuam
  recusados, com explicação e contorno de lançar à mão, FCP-ST, seguro, imposto
  de importação, IPI devolvido, serviços, item fora do total e desoneração que
  abate do total. Notas lançadas antes não foram reprocessadas; ver o registro
  de cada fase em [COMPRAS_POR_XML.md](COMPRAS_POR_XML.md);
- **fechada em 2026-09-16 (PR #407) a trava do fator de conversão que
  falhava aberta** (achado da revisão adversarial da PR #315, correção
  adiada por decisão de Rodrigo em 2026-09-02 até a tela nova de importação
  entrar no ar, o que
  ocorreu no mesmo dia). `create_xml_payable` só bloqueava quando
  `factor_confirmed` chegava explicitamente `false`; item sem o campo (NULL)
  passava sem conferência mesmo com a unidade da NF-e em família diferente da
  receita. Agora usa `coalesce(factor_confirmed, false)`, igual a
  `classify_payable_item`. Leitura live em 2026-09-16 confirmou zero rascunhos
  de importação pendentes no momento da correção;
- **corrigida em 2026-09-20 a baixa de estoque de kit vendido pelo CNM que
  reescrevia histórico.** A PR #406 (16/09) ligou venda de kit importada do
  CNM à baixa automática dos componentes físicos (`bread_movements`,
  `reference_type='venda_kit'`, ver [SALES_IMPORT_CNM.md](SALES_IMPORT_CNM.md)).
  Um gatilho em `product_components` recalculava essa baixa para *todas* as
  vendas já confirmadas do kit sempre que a receita mudava depois, usando a
  composição atual em vez da vigente na venda — o que podia mudar o saldo
  mostrado em `/estoque-paes` sem nenhuma venda ou produção nova. Rodrigo
  confirmou que essa baixa é só controle operacional, não insumo do CMV (o
  custo real segue vindo do inventário periódico), e autorizou fixar a baixa
  no momento da venda: a migration `20260920152945` remove o gatilho, e editar
  a composição de um kit deixa de tocar vendas já confirmadas. Nenhuma venda
  de kit real existe em produção até esta correção (tabelas de importação e
  vínculo vazias, conferido por leitura direta em 19 e 20/09/2026);
- **corrigido em 2026-09-23 (PR #440, issue #438) o relógio da padaria que
  atrasava 6 horas entre meia-noite e 05:59** — justamente o turno em que a
  padaria trabalha. `private.data_na_padaria()` e seu espelho no cliente
  mostravam o dia anterior nessa janela, afetando o campo de data já
  preenchido em Romaneio, Sobras, Fechamento de Caixa, Forno e Produção da
  Cozinha, além de fazer a tela inicial anunciar "Prazo encerrando — Menos de
  0h" sem nenhum prazo vencido. Os relógios do banco e do cliente foram
  unificados; as telas agora abrem no dia certo em qualquer horário;
- a tela administrativa permite conceder `romaneio.administrar` por loja,
  mas a entrada do painel administrativo do Romaneio exige escopo `*` —
  concessão por loja não abre o painel;
- **corrigido: o registro de que perfis `admin` não enxergam as telas
  financeiras estava desatualizado e foi removido em 2026-09-18.** A
  entrada citava uma auditoria de 2026-08-12 (allowed_routes de Rodrigão e
  Suélen sem `/contas-pagar` nem `/financeiro`). Hoje `canAccess`
  (`src/lib/auth.ts`) libera qualquer rota do menu para o papel `admin`
  independente de `allowed_routes`, e `DEFAULT_ROUTES_BY_ROLE.admin` já
  lista `/contas-pagar` e `/financeiro`. Rodrigão confirmou ao vivo em
  2026-09-18 (print do próprio menu) que Financeiro, Contas a pagar e
  Contas a receber aparecem no seu login. Não há registro de quando o
  código passou a permitir isso nem de por que este documento não foi
  atualizado junto — cada sessão que lia este arquivo repetia a alegação
  errada como risco aberto;
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
(regra em `docs/regras/BANCO.md`).

Em 2026-07-28, Rodrigo decidiu não investir hardening no ControlePizza, porque
essa parte será desativada em breve e não estará no projeto final. Até a
desativação, os grants legados `anon` em `pizza_*` são risco aceito: não mexer
neles sem nova decisão explícita e não criar dependência nova do ERP sobre essas
tabelas.

## Ambiente de teste

**Atualizado em 2026-08-30** (PRs #287 a #291). Antes disso, todas as PRs
disputavam um único banco de teste compartilhado.

- PR que mexe em `supabase/` recebe do Supabase um banco isolado, construído
  com as migrations e o seed fictício da própria branch. O workflow
  `Banco por PR` aponta o preview da Vercel para esse banco e manda refazer o
  deploy; `Usuarios do Banco por PR` cria nele as contas fictícias. Fechar a PR
  apaga o banco e as variáveis daquela branch.
- PR que não mexe em `supabase/` continua no `PaneERP Preview` compartilhado,
  que espelha a `main`. O critério é a pasta inteira, não só migration: mudança
  em seed, teste de banco, function ou `config.toml` também dá banco próprio. O
  job `Restaurar Banco Preview para a main` reconstrói esse espelho a cada push
  na `main` e ao fechar PR sem merge.
- A etiqueta `precisa-banco-preview`, o job que ela disparava e a espera dela
  no `ci.yml` foram removidos do código.
- **Risco aberto, ainda sem correção:** o job do smoke e o workflow do banco
  compartilhado dividem a trava de concorrência `banco-preview-compartilhado`.
  Ela protege de verdade, porque os testes de navegador **escrevem** no banco
  (criam compra, fornecedor e lançamento financeiro), mas serializa todos os
  smokes entre si. Em 2026-08-30, com cinco frentes abertas, o GitHub passou a
  cancelar quem ficava na fila: dois CIs e quatro reconstruções morreram em
  cascata e o banco ficou sem restaurar. Tirar a trava sem antes separar os
  testes que escrevem dos que só leem troca o entupimento por falha
  intermitente, e foi reprovado em revisão nesta data.
- Conferido em 2026-08-30 por leitura direta da API do Supabase, sem escrita:
  as PRs #286 e #292 tinham, ao mesmo tempo, bancos isolados próprios e
  saudáveis (`unnlpxjuxikreramqlwz` e `zexjyzvcpxpmzjlwjffe`), ambos criados
  sem dados de produção. É a prova de que a fila acabou; a leitura anterior,
  de 2026-08-28, ainda não achava banco por PR.
- Não verificado: se o banco isolado reduz a falha intermitente do smoke
  descrita no bloqueio 5. Nada foi medido depois da mudança.
- Observado em 2026-09-03, nas PRs #317 e #318: o check
  `Usuarios do Banco por PR` pode correr antes de o banco isolado daquele commit
  ficar pronto, e então falha fechado com "O Supabase Preview do commit terminou
  como skipped". Reexecutar o job resolve, sem tocar no código. Aconteceu nas
  duas PRs seguidas, o que sugere ordem de execução e não azar.
- Observado em 2026-09-03: o smoke de navegador do CI usa o `PaneERP Preview`
  compartilhado **mesmo quando a PR tem banco próprio**, e por isso falha quando
  o cenário fictício do compartilhado foi consumido por uso anterior. A mensagem
  do próprio job diz isso e manda reconstruir o banco compartilhado antes de
  reexecutar. Consequência: uma PR que mexe em `supabase/` tem o preview
  apontado para o banco dela, mas o smoke continua provando o banco espelho da
  `main`.

## Capacidades já presentes

- produção, forno e confirmação por lotes, com contexto por loja;
- programação diária de pedidos PJ pela Produção: Geolar escolhe por cliente,
  item e quantidade o que entra hoje, pode dividir a linha entre dias e indicar
  uso manual de congelados da Central. A quantidade programada sai da pendência
  imediatamente; sobras das lojas nunca atendem PJ. O saldo de congelados é
  reservado em conjunto com o planejamento de JC/JA para não prometer o mesmo
  pão duas vezes. O Forno continua agregado por pão e soma lojas, encomendas e
  somente o PJ explicitamente programado, inclusive itens do catálogo novo
  cujo processo final é forno e quantidades vendidas por kg. Produtos de
  montagem ou preparo seguem para a Cozinha de JC, sem controle de congelados.
  O Comercial informa apenas a entrega obrigatória. Agrupamento de pedidos na
  Expedição, adiantamento de entrega e cobrança pela quantidade enviada
  permanecem em fases posteriores;
- produção da Cozinha reúne, na mesma tela, a quantidade planejada dos pedidos
  PJ de JC e o lançamento livre conforme a saída da vitrine. O planejado orienta,
  mas não limita: a equipe pode registrar excedente, e o realizado persiste por
  produto e unidade. JA e EX permanecem no lançamento livre. Desde 23/09/2026
  a equipe escolhe o dia da produção entre hoje e 31 dias atrás (admin, qualquer
  dia passado; futuro nunca) e o horário real do lançamento fica registrado. O
  banco já possui ações protegidas de correção e cancelamento, restritas aos
  lotes de hoje, mas a interface dessas ações ainda não foi implementada;
- sobras, reaproveitamento e pendências com encaminhamento à Central de
  Pendências;
- romaneio com permissões granulares por ação e loja (ressalvas registradas
  em Riscos ainda abertos); desde 22/09/2026 (PR #433) a aba Fechamento soma o
  que foi enviado no dia por produto e loja, separando unidade de quilo e
  destacando o que ainda está Separado sem ter saído;
- estoques e fornecedores; em Contas a Pagar, o semáforo de compra responde
  "este fornecedor está liberado para pedido?" — leitura pura das parcelas
  vencidas em aberto por fornecedor (`summarizeSupplierPurchaseStatus`), sem
  origem de dado nova. Depende de todo boleto ser lançado no sistema, premissa
  confirmada pelo Rodrigo em 2026-08-19;
- clientes, pedidos PJ e encomendas; o Banco Preview passou a ter cenário
  comercial de PJ (clientes, tabela de preço e pedidos em aberto, por quilo,
  enviado e cancelado), o que tornou Pedidos PJ e o relatório de Vendas PJ
  testáveis antes de ir ao ar;
- tabelas e opções de preço;
- fechamento de caixa;
- livro-caixa financeiro (fase 0 de [FINANCEIRO.md](FINANCEIRO.md)): lançamento
  avulso de entrada e saída com categoria obrigatória do DRE, loja
  (`jc`/`ja`/`geral`) e conta (bancos e caixas físicos). Escrita somente pelas
  funções `create_finance_entry` e `reverse_finance_entry`; correção é
  contra-lançamento, nunca sobrescrita. Aplicado em produção em 2026-08-12
  (PR #218) e confirmado por leitura live: RLS ligada e forçada nas três
  tabelas, sem `insert` para `authenticated`, 26 categorias e 10 contas
  semeadas;
- ponte do Contas a Pagar com o livro-caixa
  (`private.sync_payable_finance_entries`): a baixa da parcela lança o valor de
  face nas categorias da compra, na competência da compra, e o que foi pago
  acima do boleto — juros e multa — vira lançamento próprio em `financeiras`,
  com previsto zero e competência no mês do pagamento, para não inflar o CMV do
  insumo. A Elis informa só o valor total pago; o acréscimo sai da diferença
  entre o valor de face e o valor pago. Pagar **menos** que o boleto segue
  recusado: desconto por antecipação exige o motivo e ainda não tem tela.
  Compra classificada como despesa financeira mantém principal e juro na mesma
  linha, por causa do índice único de um lançamento ativo por origem e
  categoria. Aplicado em produção em 2026-08-20 (PR #244) e confirmado por
  leitura live da lista de migrations;
- item de nota fiscal que não entra em receita (PR #315, no ar em 2026-09-02):
  quando a nota traz detergente, papel toalha ou material de manutenção, a
  pessoa marca *uso ou despesa* e o item deixa de exigir um item-base de
  receita. A conta para de ficar presa em pendente, e a decisão fica gravada por
  fornecedor: na nota seguinte o mesmo item já vem resolvido. A memória por
  fornecedor tem RLS forçada e escrita somente por função, e a confirmação do
  fator de conversão viaja da tela até o banco;
- contas a receber (fase 2 de [CONTAS_A_RECEBER.md](CONTAS_A_RECEBER.md)):
  cobrança de cliente PJ digitada à mão em `/contas-receber`, com vencimento
  calculado do prazo do cliente, **recebimento em pedaços** (vários por
  cobrança, cada um com data, valor, forma e conta, gerando seu próprio
  lançamento no livro), estorno por pedaço, cancelamento e correção de
  vencimento — **desde 23/09/2026 (PR #435) o vencimento também pode ser
  antecipado**, até o dia em que a cobrança foi faturada, com a mensagem de
  recusa mostrando o motivo real em vez de um recado genérico. A cobrança
  fica `parcial` enquanto faltar dinheiro, e quanto
  entrou é sempre a soma dos pedaços ativos. A fatura pode ser **dividida em
  2x ou 3x** na hora do lançamento, ou depois pela ação de dividir — o prazo do
  cliente é o teto e a última parcela cai nele. A cobrança que nasce de origem
  automática nasce sempre inteira. Escrita somente pelas cinco funções
  protegidas; RLS ligada e forçada em `receivables` e `receivable_events`. A
  baixa lança a receita no livro-caixa na mesma transação, em `clientes_pj`,
  **com competência no mês do faturamento** — cliente que paga atrasado gera
  receita em mês anterior ao do recebimento. Geração automática a partir de
  pedido PJ ainda não existe para o romaneio da Buck (fase 4);
- pedido PJ entregue vira cobrança (fase 3 de
  [CONTAS_A_RECEBER.md](CONTAS_A_RECEBER.md)) por dois caminhos que chamam o
  mesmo motor: a ação que confirma o envio gera a cobrança por dentro, sem dar
  permissão financeira à Expedição, e o financeiro tem a lista de *entregues e
  ainda não cobrados* para gerar em lote o que o envio não gerou. A decisão de
  ter os dois caminhos veio de medir produção: **116 pedidos PJ entre junho e
  13/08/2026, 1 com envio confirmado** — depender só do automático faria a
  cobrança deixar de nascer. Pedido já cobrado fica travado para alteração,
  cancelamento e exclusão; cliente sem prazo cadastrado não impede o envio, e o
  pedido fica na lista até o prazo existir;
- **desde 04/09 (PR #328) o valor da cobrança PJ é o que a Expedição
  conferiu**, e não mais a estimativa lançada no pedido
  ([QUANTIDADE_ENVIADA_PEDIDOS_PJ.md](QUANTIDADE_ENVIADA_PEDIDOS_PJ.md)). A
  regra vive em `private.valor_linha_pj` com espelho de tela em
  `src/lib/pjOrderValue.ts`; pedido fechado antes de 21/08 sem conferência
  segue cobrando a estimativa. Quantidade fora da faixa de 1/3 a 3x, ou acima
  de 50 kg / 2.000 un por linha, **não impede o fechamento do pedido**: a
  cobrança é que não nasce, e o motivo aparece escrito na lista do financeiro,
  vindo de `private.motivo_bloqueio_cobranca_pj`. O financeiro corrige depois
  por `public.corrigir_quantidade_enviada_pj` (permissão
  `pedidos_pj.corrigir_quantidade`, admin e financeiro), que refaz a cobrança
  preservando os vencimentos combinados e **é recusada em pedido com
  recebimento ativo**. Herança conhecida: onze cobranças em aberto criadas
  entre 21/08 e 04/09 nasceram pela estimativa e divergem do conferido, saldo
  de R$ 109,61 cobrados a mais, corrigíveis uma a uma pela tela;
- cobrança semanal da Buck (fases 4 e 4D de
  [CONTAS_A_RECEBER.md](CONTAS_A_RECEBER.md)): desde a PR desta fase, cada
  semana fechada da EX, de segunda a domingo, a partir de 31/08/2026, aparece
  em `/contas-receber` para o financeiro conferir. A Elis soma ajustes com
  motivo (pão sem romaneio, preço combinado, acerto) e confirma; a cobrança
  vence em 15 dias, pesa em `buck_ex` no mês em que a semana fecha e guarda a
  foto das linhas e dos ajustes. **O valor dos romaneios é somado no banco**,
  e o da tela vai só como conferência. As três travas (sem preço, unidade
  incompatível, peso acima de 10 kg) bloqueiam a semana com link para onde se
  resolve; romaneio sem conferência só gera aviso. **A receita da Buck só
  entra no livro vinda do Contas a receber**: um gatilho na tabela do livro
  recusa o lançamento direto e deixa passar o estorno dos antigos. Cobrança da
  Buck não é parcelada nem recebe mais do que falta, e a confirmação exige a
  mesma composição de romaneios que a tela mostrou. O botão do Fechamento EX saiu da tela, mas a função
  antiga `create_receivable_from_romaneio` ainda existe no banco até uma PR
  própria desligá-la. A soma vive em `private.calcular_cobranca_buck_detalhada`
  (a versão curta lê dela) e em `src/lib/romaneioBilling.ts`, que ainda
  imprime o Fechamento EX: dívida assumida, precisam mudar juntas;
- catálogo unificado com `products.kind`;
- componentes de ficha técnica, rendimentos e cálculo de CMV;
- auditoria de cobertura/qualidade do CMV;
- relatórios operacionais;
- gestão administrativa de permissões por usuário;
- layout responsivo para desktop além do mobile;
- tela de Planejamento: desde 23/09/2026 (PRs #437 e #441) abre sozinha no
  próximo dia útil de produção (considerando o horário e pulando domingo),
  troca de dia por botão em vez de calendário, mostra planejamento parcialmente
  convertido em pedido e segue a direção visual aprovada por Rodrigo (Apple
  Design), sem mudar regra, quantidade ou permissão.

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

### Catálogo: tipos e categorias controladas

Plano em [CATALOGO_PRODUTOS.md](CATALOGO_PRODUTOS.md). A fase 1 (PR #318, em
produção desde 03/09/2026) criou a estrutura controlada e a tela de categorias
sem reclassificar nada, e a lista ficou vazia.

Em 22/09/2026 a unificação do texto livre (PR #432) deixou 20 grafias limpas, e
a fase 2A (PR #434) preencheu a lista com essas 20 categorias, cada uma num
tipo de item, e classificou o catálogo inteiro casando pelo nome normalizado.
A fase 2B trocou o campo de texto do cadastro de produto pela lista controlada:
escolher a categoria grava, no mesmo salvamento, a categoria, o tipo de item e o
texto legado com o nome dela. Produto novo não salva sem categoria; produto
antigo continua salvando. A marcação `is_revenda` deixou de ser resposta
própria e virou espelho do tipo de item, por decisão do Rodrigo em 22/09/2026.

O texto livre continua em uso em Sobras, Itens JC, Tabelas de preço e na
contagem de estoque, e só sai de cena na fase 4. Falta ainda quebrar os 340
insumos em famílias reais (fase 3) e os relatórios por família (fase 5); nesses
relatórios, soma por tipo de item precisa excluir `kind = 'kit'`, senão conta o
kit e os pães dele duas vezes.

### Produção: classificação operacional dos produtos

`products` separa a categoria comercial da classificação usada pela produção:
área responsável, processo final (`forno`, `montagem` ou `preparo`) e permissão
para produção planejada e/ou lançamento sem ordem. Cadastros antigos de
fabricação própria continuam funcionando com a classificação pendente, sem
inferência automática por nome ou categoria.

Pedidos PJ e Forno usam essa classificação para produtos cujo processo final é
`forno`. Um produto classificado pode ser programado e confirmado sem depender
de cadastro duplicado em `breads`; a programação, o realizado, o histórico e o
saldo guardam sua identidade e uma fotografia do nome e da unidade. Registros
antigos continuam identificados como pão legado, sem reescrita do histórico.

Produtos sem classificação continuam visíveis na fila PJ, mas bloqueados com o
motivo. Produtos de `montagem` e `preparo` não entram no Forno: a programação PJ
deles segue para a Cozinha de JC e aparece junto do lançamento livre por demanda.
Produto inativado depois de um pedido aceito continua atendível, com aviso; a
inativação impede novos pedidos, não apaga o compromisso existente. A
classificação não gera ordens de componentes ou semiacabados e nenhum lançamento
da Cozinha movimenta estoque nesta fase.

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
   live de 2026-07-28 no escopo do ERP: resta só a exposição GraphQL (a
   revisão das funções privilegiadas fechou em 2026-09-23 sem defeito, e a
   configuração de senha vazada foi resolvida — ver Riscos ainda abertos).
   Este bloqueio deixou de travar funcionalidade nova — ver a decisão em
   Fase estratégica.
4. Os planos de permissão (`allowed_routes` × `app_user_permissions`) ainda não
   são sincronizados nos módulos antigos; Pedidos PJ já usa a permissão
   granular para menu e rota.
5. O smoke de navegador ainda falha de forma intermitente por causa de
   ambiente: login logo após a recriação das contas fictícias, e o cenário da
   Geolar, que oscila desde o PR #199. Enquanto restarem, o semáforo segura
   entregas sem relação com a falha.
   O caso do Romaneio EX saiu dessa lista no PR #250: a causa não era ambiente
   nem tempo, e sim o teste esperar pelo próprio dado que ia conferir, o que
   transformava cenário consumido em tempo esgotado. A espera passou a mirar
   um sinal de prontidão, e o job confere o cenário fictício antes de rodar.
   Diagnóstico de falha de smoke deve separar as duas famílias antes de
   aumentar qualquer tempo limite (ver `lessons.md`,
   `tela-vazia-nao-e-tela-carregando`).
   Em merge com migration, os gatilhos simultâneos de push e fechamento da PR
   também podem cancelar a reconstrução automática do Banco Preview antes de ela
   iniciar; o navegador da `main` fica esperando esse check. A recuperação segura
   é reconstruir o banco fictício pelo workflow próprio e repetir o CI. A causa
   estrutural de concorrência ainda precisa de correção separada.

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
