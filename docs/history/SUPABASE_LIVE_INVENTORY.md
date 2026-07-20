# SUPABASE_LIVE_INVENTORY.md - Inventario live Supabase

**Data:** 2026-06-13
**Sprint:** 0B - inventario live de seguranca
**Projeto Supabase:** PanePedidosLojas (`gohluceldchoitihrimw`)
**Status:** inventario real obtido via Supabase MCP, somente leitura

## 1. Objetivo do inventario

Registrar o estado real atual do Supabase antes de qualquer correcao de RLS/Auth.

Este documento transforma a auditoria documental da Sprint 0A em inventario live: tabelas publicas, RLS, policies, grants, Edge Functions e riscos. Ele nao aplica nenhuma correcao. O objetivo e orientar os proximos PRs de seguranca sem quebrar a operacao atual do ERP.

## 2. Data e escopo

Inventario executado em 2026-06-13.

Escopo incluido:

- schema `public` do Supabase;
- tabelas publicas usadas pelo ERP;
- status de RLS e `force_rls`;
- policies de RLS existentes;
- grants para roles `anon` e `authenticated`;
- Edge Functions deployadas;
- leitura local de arquivos para cruzar tabela, modulo e uso provavel.

Escopo nao incluido:

- leitura de dados de negocio nas tabelas;
- leitura de valores de secrets;
- alteracao de banco;
- criacao de migrations;
- deploy de Edge Functions;
- alteracao de codigo, `.env`, `package.json` ou docs anteriores.

## 3. Fontes usadas

### Arquivos locais

- `AGENTS.md`
- `docs/CODEX_PROJECT_COMMAND.md`
- `docs/SUPABASE_SECURITY_AUDIT.md`
- `README.md`
- `CLAUDE.md`
- `docs/PRD.md`
- `docs/PLAN.md`
- `docs/TASKS.md`
- `docs/CMV_EXECUTION_PLAN.md`
- `docs/SALES_IMPORT_CNM.md`
- `docs/DESIGN_AUDIT.md`
- `src/lib/database.types.ts`
- `src/lib/auth.ts`
- `src/lib/supabase.ts`
- chamadas Supabase em `src/app/**`
- `supabase/functions/parse-cotacao/index.ts`

### Supabase MCP

Foram usadas apenas operacoes de leitura:

- listar projetos;
- listar tabelas do schema `public`;
- listar Edge Functions;
- ler metadados/codigo das Edge Functions;
- executar SELECTs read-only em catalogos Postgres.

### Queries read-only usadas

Foram executados SELECTs sobre:

- `pg_class` e `pg_namespace`, para tabelas, RLS e `force_rls`;
- `pg_policies`, para policies;
- `information_schema.role_table_grants`, para grants de `anon` e `authenticated`;
- `pg_proc`, para funcoes SQL publicas;
- `pg_class` com `relkind in ('v', 'm')`, para views/materialized views publicas.

## 4. Limites

Conexao live ao Supabase foi bem-sucedida via MCP.

Limites restantes:

- nao foi usado Supabase CLI, porque o MCP estava disponivel e suficiente;
- nao foram lidos valores de secrets, apenas nomes inferidos pelo codigo das Edge Functions;
- nao foi testado acesso HTTP direto com anon key;
- nao foi feita tentativa de escrita para validar bloqueios;
- nao foi feita alteracao em RLS, grants, policies ou Edge Functions.

## 5. Resumo executivo

O inventario confirma risco critico.

- Existem 36 tabelas publicas no schema `public`.
- 13 tabelas publicas estao com RLS desligado.
- Todas as 36 tabelas tem grants amplos para `anon` e `authenticated`: `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`.
- Nas tabelas com RLS ligado, a maioria das policies permite `anon` com `USING true` e/ou `WITH CHECK true`.
- `app_users` tem RLS ligado, mas possui policy `anon_select_for_login` com `USING true`, expondo a tabela para leitura anonima.
- Nao ha `force_rls` ligado em nenhuma tabela publica.
- Nao ha funcoes SQL publicas encontradas no schema `public`.
- Nao ha views/materialized views publicas encontradas no schema `public`.
- Ha duas Edge Functions ativas: `analisar-desconto` com `verify_jwt=false` e `parse-cotacao` com `verify_jwt=true`.

## 6. Lista de tabelas publicas

Prioridade:

- P0: corrigir antes de qualquer dado financeiro novo.
- P1: corrigir na primeira rodada de RLS/Auth apos P0.
- P2: corrigir apos os fluxos financeiros/operacionais principais.
- P3: baixo risco relativo, mas ainda deve seguir deny-by-default.

| Tabela | Linhas | Uso provavel no ERP | Modulo relacionado | RLS | Sensibilidade | Prioridade |
| --- | ---: | --- | --- | --- | --- | --- |
| `app_users` | 13 | Usuarios, PINs, roles, rotas e loja | Login/Admin usuarios | ON | Critica | P0 |
| `bread_movements` | 71 | Movimentos de paes, baixa por producao/kit/romaneio/descarte | Forno, estoque paes, sobras, romaneio | ON | Alta | P1 |
| `breads` | 41 | Catalogo de paes, custo e flags operacionais | Catalogo, producao, forno, estoque paes | ON | Alta | P1 |
| `customer_price_overrides` | 1 | Precos especiais por cliente | Clientes PJ, tabelas de preco | ON | Critica | P0 |
| `customers` | 30 | Clientes PJ e dados comerciais | Clientes, pedidos PJ, relatorios | ON | Critica | P0 |
| `descartes` | 83 | Descartes por produto/data/responsavel | Sobras/descartes, relatorios | OFF | Alta | P0 |
| `destinations` | 3 | Destinos/lojas do romaneio | Romaneio | OFF | Baixa | P2 |
| `frozen_movements` | 379 | Movimentos do estoque congelado | Estoque congelado | ON | Alta | P1 |
| `frozen_products` | 47 | Catalogo de produtos congelados | Estoque congelado | OFF | Media | P1 |
| `frozen_stock` | 74 | Saldos por local de congelado | Estoque congelado | OFF | Alta | P1 |
| `orders` | 2772 | Pedidos de producao, PJ e encomendas | Producao, forno, pedidos PJ | ON | Alta | P1 |
| `price_tier_items` | 46 | Itens/precos de tabelas comerciais | Tabelas de preco | ON | Critica | P0 |
| `price_tiers` | 12 | Tabelas comerciais | Tabelas de preco | ON | Alta | P0 |
| `product_components` | 4 | BOM/composicao de kits | Produtos, sobras, romaneio, futuro CMV | ON | Alta | P1 |
| `product_prices` | 1 | Precos de produto legado/apoio | Catalogo/precos | OFF | Alta | P1 |
| `product_production` | 12 | Lista de producao de itens nao-paes por loja/data | Producao | ON | Alta | P1 |
| `production_actuals` | 47 | Producao real registrada | Forno/producao | ON | Alta | P1 |
| `products` | 424 | Catalogo geral, custos, kind, revenda, especiais | Produtos, compras, estoque, CMV | OFF | Alta | P0 |
| `purchase_items` | 163 | Itens de listas de compra | Compras | ON | Alta | P1 |
| `purchase_lists` | 3 | Listas de compra por setor/status | Compras | ON | Alta | P1 |
| `quotation_items` | 19 | Itens de cotacao | Cotacoes | ON | Alta | P1 |
| `quotation_responses` | 0 | Respostas/precos de fornecedores | Cotacoes | ON | Alta | P1 |
| `quotation_suppliers` | 4 | Fornecedores envolvidos em cotacao | Cotacoes | ON | Alta | P1 |
| `quotations` | 1 | Cabecalho/status de cotacao | Cotacoes | ON | Alta | P1 |
| `romaneio_items` | 6 | Itens transferidos no romaneio | Romaneio | OFF | Alta | P1 |
| `romaneios` | 1 | Cabecalhos de romaneio | Romaneio | OFF | Alta | P1 |
| `shelf_counts` | 35 | Contagem de prateleira | Sobras/relatorios | ON | Media | P2 |
| `sobras` | 263 | Sobra por produto/data/responsavel | Sobras/descartes, relatorios | OFF | Alta | P0 |
| `stock_balance` | 0 | Saldo e custo medio de insumos | Estoque de insumos, CMV | OFF | Critica | P0 |
| `stock_entries` | 0 | Entradas de compra de insumos | Estoque entrada, compras/XML futuro | OFF | Critica | P0 |
| `stock_entry_items` | 0 | Itens das entradas de compra | Estoque entrada, compras/XML futuro | OFF | Critica | P0 |
| `stock_movements` | 0 | Movimentos de estoque de insumos | Estoque de insumos, CMV | ON | Critica | P0 |
| `supplier_order_items` | 0 | Itens de pedidos a fornecedores | Cotacoes/compras | ON | Alta | P1 |
| `supplier_orders` | 0 | Pedidos gerados para fornecedores | Cotacoes/compras | ON | Alta | P1 |
| `supplier_products` | 72 | Mapa fornecedor-produto | Fornecedores/cotacoes | ON | Alta | P1 |
| `suppliers` | 6 | Cadastro de fornecedores | Fornecedores/compras | OFF | Alta | P0 |

Tabelas com RLS desligado: `products`, `sobras`, `descartes`, `destinations`, `romaneios`, `romaneio_items`, `product_prices`, `frozen_products`, `frozen_stock`, `suppliers`, `stock_entries`, `stock_entry_items`, `stock_balance`.

## 7. Lista de policies por tabela

Risco padrao usado abaixo:

- Critico: policy ou ausencia de RLS permite acesso anonimo a auth, custos, clientes, precos ou estoque financeiro.
- Alto: policy permite anonimo alterar operacao, producao, compras, cotacoes ou movimentos.
- Medio: policy anonima em dado operacional menos sensivel, ainda inadequada.

| Tabela | Policy | Comando | Role | USING | WITH CHECK | Risco |
| --- | --- | --- | --- | --- | --- | --- |
| `app_users` | `anon_select_for_login` | SELECT | `anon` | `true` | - | Critico: expoe usuarios, roles, rotas, lojas e PINs se a tabela contem PIN em claro. |
| `bread_movements` | `anon_delete` | DELETE | `anon` | `true` | - | Alto: permite excluir movimentos de paes. |
| `bread_movements` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar movimentos de paes. |
| `bread_movements` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler movimentos operacionais. |
| `breads` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar item de catalogo/custo. |
| `breads` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler catalogo/custos. |
| `breads` | `anon_update` | UPDATE | `anon` | `true` | `true` | Alto: permite alterar catalogo/custos. |
| `customer_price_overrides` | `anon_insert` | INSERT | `anon` | - | `true` | Critico: permite criar preco especial. |
| `customer_price_overrides` | `anon_select` | SELECT | `anon` | `true` | - | Critico: expoe descontos/precos negociados. |
| `customer_price_overrides` | `anon_update` | UPDATE | `anon` | `true` | `true` | Critico: permite alterar preco especial. |
| `customers` | `anon_insert` | INSERT | `anon` | - | `true` | Critico: permite criar cliente. |
| `customers` | `anon_select` | SELECT | `anon` | `true` | - | Critico: expoe clientes PJ. |
| `customers` | `anon_update` | UPDATE | `anon` | `true` | `true` | Critico: permite alterar cliente/desconto. |
| `frozen_movements` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar movimento de congelado. |
| `frozen_movements` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler movimentos de estoque. |
| `orders` | `anon_delete` | DELETE | `anon` | `true` | - | Alto: permite excluir pedidos. |
| `orders` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar pedidos. |
| `orders` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler producao/PJ/encomendas. |
| `orders` | `anon_update` | UPDATE | `anon` | `true` | `true` | Alto: permite alterar pedidos. |
| `price_tier_items` | `anon_insert` | INSERT | `anon` | - | `true` | Critico: permite criar preco de tabela. |
| `price_tier_items` | `anon_select` | SELECT | `anon` | `true` | - | Critico: expoe precos comerciais. |
| `price_tier_items` | `anon_update` | UPDATE | `anon` | `true` | `true` | Critico: permite alterar precos comerciais. |
| `price_tiers` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar tabela de preco. |
| `price_tiers` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler tabelas de preco. |
| `price_tiers` | `anon_update` | UPDATE | `anon` | `true` | `true` | Alto: permite alterar tabelas de preco. |
| `product_components` | `anon_delete` | DELETE | `anon` | `true` | - | Alto: permite excluir composicao de kit. |
| `product_components` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar composicao de kit. |
| `product_components` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler BOM/composicao. |
| `product_components` | `anon_update` | UPDATE | `anon` | `true` | `true` | Alto: permite alterar BOM/composicao. |
| `product_production` | `anon_delete` | DELETE | `anon` | `true` | - | Alto: permite excluir producao de itens nao-paes. |
| `product_production` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar producao de itens nao-paes. |
| `product_production` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler producao. |
| `product_production` | `anon_update` | UPDATE | `anon` | `true` | `true` | Alto: permite alterar producao. |
| `production_actuals` | `anon_delete` | DELETE | `anon` | `true` | - | Alto: permite excluir producao real. |
| `production_actuals` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar producao real. |
| `production_actuals` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler producao real. |
| `purchase_items` | `anon_delete` | DELETE | `anon` | `true` | - | Alto: permite excluir itens de compra. |
| `purchase_items` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar itens de compra. |
| `purchase_items` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler compras. |
| `purchase_items` | `anon_update` | UPDATE | `anon` | `true` | `true` | Alto: permite alterar compras. |
| `purchase_lists` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar lista de compra. |
| `purchase_lists` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler listas de compra. |
| `purchase_lists` | `anon_update` | UPDATE | `anon` | `true` | `true` | Alto: permite alterar status/lista. |
| `quotation_items` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar itens de cotacao. |
| `quotation_items` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler cotacoes. |
| `quotation_responses` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar resposta/preco fornecedor. |
| `quotation_responses` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler respostas/precos. |
| `quotation_responses` | `anon_update` | UPDATE | `anon` | `true` | `true` | Alto: permite alterar respostas/precos. |
| `quotation_suppliers` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite vincular fornecedor a cotacao. |
| `quotation_suppliers` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler fornecedores da cotacao. |
| `quotation_suppliers` | `anon_update` | UPDATE | `anon` | `true` | `true` | Alto: permite alterar status/mensagem da cotacao. |
| `quotations` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar cotacao. |
| `quotations` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler cotacoes. |
| `quotations` | `anon_update` | UPDATE | `anon` | `true` | `true` | Alto: permite alterar/fechar cotacao. |
| `shelf_counts` | `anon_insert` | INSERT | `anon` | - | `true` | Medio: permite criar contagem de prateleira. |
| `shelf_counts` | `anon_select` | SELECT | `anon` | `true` | - | Medio: permite ler contagens. |
| `shelf_counts` | `anon_update` | UPDATE | `anon` | `true` | `true` | Medio: permite alterar contagens. |
| `stock_movements` | `anon_insert` | INSERT | `anon` | - | `true` | Critico: permite criar movimento de estoque de insumo. |
| `stock_movements` | `anon_select` | SELECT | `anon` | `true` | - | Critico: permite ler movimentos de insumo/CMV. |
| `supplier_order_items` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar item de pedido fornecedor. |
| `supplier_order_items` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler pedido fornecedor. |
| `supplier_orders` | `anon_delete` | DELETE | `anon` | `true` | - | Alto: permite excluir pedido fornecedor. |
| `supplier_orders` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar pedido fornecedor. |
| `supplier_orders` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler pedidos fornecedores. |
| `supplier_orders` | `anon_update` | UPDATE | `anon` | `true` | `true` | Alto: permite alterar pedidos fornecedores. |
| `supplier_products` | `anon_delete` | DELETE | `anon` | `true` | - | Alto: permite excluir mapa fornecedor-produto. |
| `supplier_products` | `anon_insert` | INSERT | `anon` | - | `true` | Alto: permite criar mapa fornecedor-produto. |
| `supplier_products` | `anon_select` | SELECT | `anon` | `true` | - | Alto: permite ler mapa fornecedor-produto. |
| `supplier_products` | `anon_update` | UPDATE | `anon` | `true` | `true` | Alto: permite alterar mapa fornecedor-produto. |

Tabelas com RLS desligado nao aparecem em `pg_policies`, mas seguem expostas porque possuem grants amplos para `anon` e `authenticated`.

## 8. Grants para anon/authenticated

Resultado live: todas as 36 tabelas publicas possuem grants para `anon` e `authenticated`.

Permissoes concedidas em todas elas:

```text
DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
```

Tabelas acessiveis por `anon` e `authenticated`:

```text
app_users
bread_movements
breads
customer_price_overrides
customers
descartes
destinations
frozen_movements
frozen_products
frozen_stock
orders
price_tier_items
price_tiers
product_components
product_prices
product_production
production_actuals
products
purchase_items
purchase_lists
quotation_items
quotation_responses
quotation_suppliers
quotations
romaneio_items
romaneios
shelf_counts
sobras
stock_balance
stock_entries
stock_entry_items
stock_movements
supplier_order_items
supplier_orders
supplier_products
suppliers
```

Risco: mesmo nas tabelas com RLS ligado, grants amplos aumentam o impacto de qualquer policy permissiva. Nas tabelas com RLS desligado, estes grants tornam o acesso anonimo efetivo para leitura e escrita.

## 9. Edge Functions

| Function | Status | `verify_jwt` | Secrets envolvidos | Risco |
| --- | --- | --- | --- | --- |
| `analisar-desconto` | ACTIVE | `false` | `ANTHROPIC_API_KEY` | Critico: function com custo de IA, CORS amplo, sem JWT obrigatorio e nao versionada localmente em `supabase/functions/`. Pode ser chamada fora do ERP se a URL for conhecida. |
| `parse-cotacao` | ACTIVE | `true` | `GEMINI_API_KEY` | Alto: exige JWT, mas o app chama com credencial publica/anon. Tem CORS amplo e custo de IA. O codigo esta versionado localmente. |

Observacoes:

- `analisar-desconto` esta deployada na versao 4 e usa Claude/Anthropic.
- `parse-cotacao` esta deployada na versao 1 e usa Gemini.
- Nenhum valor de secret foi lido ou exposto.
- `analisar-desconto` nao existe no diretorio local `supabase/functions/`, apesar de estar ativa no projeto.

## 10. Funcoes SQL e views publicas

Resultado live:

- nenhuma funcao SQL encontrada no schema `public`;
- nenhuma view ou materialized view encontrada no schema `public`.

Risco atual nesta area: baixo.

Observacao: se forem criadas funcoes transacionais no futuro, especialmente para estoque/CMV, elas nao devem ficar expostas sem revisao. Funcoes `security definer` devem ficar fora de schemas expostos ou ter revisao especifica.

## 11. Matriz de risco

### Critico

- `app_users`: leitura anonima via policy `anon_select_for_login`; grants de escrita tambem existem para `anon`/`authenticated`, ainda que RLS bloqueie escrita sem policy especifica.
- Tabelas de estoque/CMV com RLS desligado: `stock_entries`, `stock_entry_items`, `stock_balance`.
- `stock_movements`: RLS ligado, mas anon pode `SELECT` e `INSERT` com `true`.
- Dados comerciais de clientes/precos: `customers`, `price_tiers`, `price_tier_items`, `customer_price_overrides` com policies anon permissivas.
- `analisar-desconto`: Edge Function ativa, com custo de IA e `verify_jwt=false`.

### Alto

- 13 tabelas com RLS desligado, incluindo `products`, `sobras`, `descartes`, `suppliers`, `frozen_stock`, `romaneios` e `romaneio_items`.
- Tabelas de compras/cotacoes com policies anon permissivas: `purchase_*`, `quotation_*`, `supplier_*`.
- Tabelas de producao e pedidos com policies anon permissivas: `orders`, `product_production`, `production_actuals`, `bread_movements`.
- `parse-cotacao`: `verify_jwt=true`, mas ainda exposta ao modelo atual sem identidade real de usuario.

### Medio

- `shelf_counts`, `frozen_products`, `destinations`: impacto menor isoladamente, mas ainda podem contaminar operacao/relatorios.
- Catalogos compartilhados (`breads`, `product_components`) com escrita anonima via policy.

### Baixo

- Nao foram encontradas views publicas nem funcoes SQL publicas.
- Tabelas vazias de estoque ainda tem baixo volume de dados, mas risco estrutural critico antes de receber XML/compras reais.

## 12. Recomendacoes de correcao, sem aplicar nada

### Tabelas para corrigir primeiro

1. `app_users`: remover exposicao anonima ampla como base da transicao para Supabase Auth/perfis.
2. `stock_entries`, `stock_entry_items`, `stock_balance`, `stock_movements`: proteger antes de XML de compras e CMV.
3. `customers`, `price_tiers`, `price_tier_items`, `customer_price_overrides`: proteger dados comerciais e descontos.
4. `products`, `suppliers`, `supplier_products`: proteger catalogo com custo e mapa fornecedor-produto.
5. `sobras`, `descartes`, `orders`, `product_production`, `production_actuals`, `bread_movements`: proteger dados que alimentarao perdas e CMV.
6. `purchase_*`, `quotation_*`, `supplier_order_*`: revisar antes de evoluir Compras v2.

### Policies para revisar primeiro

1. `app_users.anon_select_for_login`.
2. Todas as policies com role `anon` e expressao `USING true`.
3. Todas as policies com role `anon` e expressao `WITH CHECK true`.
4. Policies anonimas de escrita em clientes, precos, estoque, compras e producao.
5. Policies de DELETE anonimo: `orders`, `bread_movements`, `product_components`, `product_production`, `production_actuals`, `purchase_items`, `supplier_orders`, `supplier_products`.

### Grants para revisar primeiro

1. Remover grants desnecessarios de `TRUNCATE`, `TRIGGER`, `REFERENCES` para `anon` e `authenticated`.
2. Reduzir grants diretos de escrita para `anon` apos desenhar RLS/Auth real.
3. Manter grants compativeis com a Data API apenas onde houver RLS forte e policies restritas.

### Edge Functions para proteger primeiro

1. `analisar-desconto`: decidir entre desativar temporariamente, versionar no repo e/ou exigir JWT/autenticacao real.
2. `parse-cotacao`: manter versionada, mas revisar CORS, tamanho de payload, rate/cost guard e identidade do solicitante.

## 13. Proximo PR recomendado

Branch sugerida:

```text
codex/supabase-auth-rls-plan
```

Escopo:

- criar um plano tecnico detalhado para transicao de auth custom para Supabase Auth/perfis;
- desenhar policies por role/loja antes de aplicar qualquer SQL;
- definir ordem de migrations pequenas;
- definir smoke tests por modulo e por perfil;
- documentar rollback e risco operacional.

Arquivos envolvidos:

- novo documento em `docs/`, por exemplo `docs/SUPABASE_RLS_REMEDIATION_PLAN.md`;
- nenhum schema/migration no primeiro PR de plano.

Tabelas envolvidas no desenho:

- `app_users` ou tabela substituta de perfis;
- `stock_*`;
- `customers` e `price_*`;
- `products`, `suppliers`, `supplier_products`;
- `orders`, `sobras`, `descartes`;
- `purchase_*`, `quotation_*`, `supplier_order_*`.

Validacao necessaria:

- `git diff --check`;
- revisao manual do Rodrigo antes de qualquer PR com SQL;
- em PR posterior de SQL, testar perfil por perfil e modulo por modulo antes de liberar dados financeiros novos.

## 14. Conclusao

O Supabase esta funcional para o modelo atual do app, mas nao esta seguro para a proxima fase de dados financeiros.

O problema nao e apenas "RLS desligado". O problema completo e:

- app estatico usando chave publica;
- auth real ausente;
- grants amplos em todas as tabelas;
- RLS desligado em 13 tabelas;
- policies anon permissivas nas tabelas com RLS ligado;
- Edge Function de IA sem JWT.

Recomendacao principal: nao iniciar XML de compras, vendas CNM, ficha tecnica versionada ou CMV com dados sensiveis antes de corrigir a base de Auth/RLS.
