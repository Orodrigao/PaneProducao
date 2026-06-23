# Supabase RLS — auditoria live apos Auth

Data: 2026-06-23

## Objetivo

Registrar o estado real de RLS, policies e exposicao do Supabase depois da criacao dos usuarios Auth, dos profiles e da validacao do login por e-mail + senha.

Esta auditoria e somente leitura. Nenhum SQL de escrita foi executado.

## Contexto

- O ERP segue como app estatico Next.js, acessando Supabase diretamente pelo navegador.
- O login por e-mail + senha esta funcionando.
- O login por PIN continua como fallback operacional.
- `public.app_profiles` ja e usado para montar o usuario autenticado por e-mail.
- `public.app_users` ainda existe para o fluxo legado por PIN.

## Fontes consultadas

- Supabase MCP, somente leitura:
  - inventario de tabelas publicas;
  - `pg_policies`;
  - grants para `anon` e `authenticated`;
  - funcoes em `public`;
  - advisors de seguranca.
- Codigo local em `src/`, para mapear tabelas usadas pelo frontend.
- Documentacao oficial Supabase:
  - Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
  - Securing your data/API: https://supabase.com/docs/guides/database/secure-data
  - Management API: https://supabase.com/docs/reference/api/introduction
  - Changelog Supabase: https://supabase.com/changelog

## O que foi confirmado como bom

### Auth e profiles

Consulta live:

```text
auth_users_count: 13
app_profiles_count: 13
profiles_with_auth_user: 13
active_profiles: 13
```

Conclusao:

- todos os 13 profiles estao vinculados a usuarios reais do Supabase Auth;
- todos os profiles estao ativos;
- a primeira leva Auth nao precisa ser recriada.

### `app_profiles`

Estado live:

- RLS ligado;
- force RLS ligado;
- nenhuma permissao para `anon`;
- `authenticated` tem somente `SELECT`;
- policy existente: usuario autenticado le somente o proprio profile, por `user_id = auth.uid()`.

Conclusao: `app_profiles` esta no desenho correto para a transicao de Auth.

### Views publicas

Nao ha views no schema `public`.

Isso reduz um risco comum de Supabase, porque views podem contornar RLS dependendo de como sao criadas.

## Riscos confirmados

### 1. RLS desligado em 13 tabelas publicas

As seguintes tabelas seguem com RLS desligado:

| Tabela | Linhas estimadas | Impacto |
| --- | ---: | --- |
| `sobras` | 450 | Perdas/sobras operacionais |
| `products` | 426 | Catalogo, custos e classificacoes |
| `descartes` | 128 | Descartes operacionais |
| `frozen_stock` | 84 | Saldo de congelados |
| `frozen_products` | 50 | Catalogo de congelados |
| `romaneio_items` | 6 | Itens de romaneio |
| `suppliers` | 6 | Fornecedores |
| `destinations` | 3 | Destinos de romaneio |
| `product_prices` | 1 | Precos auxiliares/legados |
| `romaneios` | 1 | Cabecalho de romaneio |
| `stock_balance` | 0 | Saldo de insumos e custo medio futuro |
| `stock_entries` | 0 | Entradas de compra futuras |
| `stock_entry_items` | 0 | Itens de compra futuros |

Essas tabelas tambem possuem grants amplos para `anon` e `authenticated`, incluindo `SELECT`, `INSERT`, `UPDATE`, `DELETE` e `TRUNCATE`.

Impacto pratico: enquanto RLS estiver desligado, a chave publica do frontend pode acessar essas tabelas conforme os grants. Isso e o maior risco atual.

### 2. Policies antigas permitem escrita anonima em 22 tabelas

Foram encontradas policies `anon` com `USING true` ou `WITH CHECK true` para escrita em 22 tabelas.

Exemplos de tabelas afetadas:

- `orders`;
- `bread_movements`;
- `breads`;
- `customers`;
- `customer_price_overrides`;
- `price_tiers`;
- `price_tier_items`;
- `product_components`;
- `product_production`;
- `production_actuals`;
- `purchase_lists`;
- `purchase_items`;
- `quotations`;
- `quotation_items`;
- `quotation_suppliers`;
- `quotation_responses`;
- `supplier_products`;
- `supplier_orders`;
- `supplier_order_items`;
- `shelf_counts`;
- `stock_movements`;
- `frozen_movements`.

Impacto pratico: RLS esta ligado nessas tabelas, mas varias policies ainda dizem, na pratica, "anon pode gravar". Isso manteve o app funcionando antes do Auth, mas agora precisa ser substituido por regras de usuario autenticado, role e loja.

### 3. Grants amplos continuam em quase todo o schema publico

Mesmo quando RLS bloqueia a acao, as permissoes de tabela para `anon` e `authenticated` continuam amplas na maior parte do banco.

Impacto pratico:

- com RLS desligado, o grant vira acesso efetivo;
- com RLS ligado, uma policy permissiva torna o grant perigoso;
- qualquer tabela nova ou policy mal criada pode reabrir acesso indevido.

### 4. `app_users` ainda esta exposta para o fallback por PIN

Estado live:

- RLS ligado;
- policy `anon_select_for_login` permite `SELECT` com `true`;
- grants de escrita existem para `anon` e `authenticated`, mas nao ha policy de escrita correspondente;
- o codigo ainda possui funcoes de leitura/escrita de `app_users`.

Impacto pratico:

- leitura anonima de `app_users` ainda existe para o login legado;
- a escrita parece bloqueada por RLS hoje, mas os grants sao amplos e devem ser reduzidos depois;
- so e seguro fechar `app_users` depois que o PIN deixar de ser necessario ou virar fallback muito restrito.

### 5. Funcao `set_app_profiles_updated_at`

Estado live:

- nao e `security definer`;
- esta em `public`;
- tem warning de `search_path` mutavel;
- tem `EXECUTE` para `anon` e `authenticated`.

Impacto pratico:

- risco baixo comparado a RLS desligado;
- ainda assim deve ser corrigida em migration futura: definir `search_path` fixo e revogar `EXECUTE` publico se nao for necessario.

### 6. Protecao contra senhas vazadas segue desligada

O advisor de seguranca ainda aponta leaked password protection desligada.

Isso ja foi tentado antes, mas o Supabase retornou que o recurso exige plano Pro ou superior.

## Cruzamento com o frontend

O frontend acessa diretamente as seguintes tabelas via Supabase:

```text
app_profiles
app_users
bread_movements
breads
customer_price_overrides
customers
descartes
frozen_movements
frozen_products
frozen_stock
orders
price_tier_items
price_tiers
product_components
production_actuals
products
purchase_items
purchase_lists
quotation_items
quotation_responses
quotation_suppliers
quotations
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

Conclusao: nao da para simplesmente bloquear `anon` ou ligar RLS restritivo em massa. Isso quebraria telas em uso. A correcao precisa ser por lotes pequenos.

## Prioridade recomendada

### P0 — proteger antes de qualquer novo dado financeiro

1. `stock_entries`, `stock_entry_items`, `stock_balance`, `stock_movements`
   - base futura de XML, compras, custo medio e CMV;
   - hoje algumas estao vazias, portanto este e um bom ponto para proteger antes de receber dados reais.

2. `customers`, `price_tiers`, `price_tier_items`, `customer_price_overrides`
   - clientes PJ, descontos e precos negociados;
   - ja tem dados reais e policies permissivas.

3. `suppliers`, `products`
   - fornecedores e catalogo/custos;
   - essenciais para compras e CMV.

4. `sobras`, `descartes`
   - perdas operacionais;
   - vao entrar no CMV/perdas.

5. `app_users`
   - deve ser fechado depois que o fluxo por e-mail estiver estavel e o fallback por PIN puder ser removido ou isolado.

### P1 — proteger logo depois do P0

- `orders`, `production_actuals`, `product_production`;
- `bread_movements`;
- `purchase_lists`, `purchase_items`;
- `quotations`, `quotation_items`, `quotation_suppliers`, `quotation_responses`;
- `supplier_products`, `supplier_orders`, `supplier_order_items`;
- `romaneios`, `romaneio_items`;
- `frozen_products`, `frozen_stock`, `frozen_movements`;
- `product_components`.

## Plano de correcao recomendado

### Etapa 1 — hardening sem mexer em dado operacional

Criar PR pequeno com migration para:

- corrigir `set_app_profiles_updated_at` com `search_path` fixo;
- remover `EXECUTE` publico dessa funcao se confirmado que nao e chamada diretamente pelo app;
- validar que `app_profiles` continua funcionando no login.

Risco: baixo.

### Etapa 2 — proteger tabelas de estoque ainda vazias

Criar PR pequeno para proteger:

- `stock_entries`;
- `stock_entry_items`;
- `stock_balance`.

Como essas tabelas estao vazias, e possivel desenhar a policy correta antes da entrada de XML/compras reais.

Risco: medio, porque `/estoque` e `/estoque/entrada` precisam ser testados.

### Etapa 3 — clientes e precos

Criar policies por role para:

- `customers`;
- `price_tiers`;
- `price_tier_items`;
- `customer_price_overrides`.

Regra alvo:

- `admin` e `financeiro` podem ler/escrever;
- outros roles nao devem acessar dados comerciais sensiveis.

Risco: medio/alto, porque impacta Clientes, Tabelas de preco, Pedidos PJ e relatorios PJ.

### Etapa 4 — compras, fornecedores e produtos

Criar policies para:

- `products`;
- `suppliers`;
- `supplier_products`;
- `purchase_lists`;
- `purchase_items`;
- `quotations` e relacionadas.

Regra alvo:

- leitura de catalogo pode ser mais ampla para roles internos;
- escrita em fornecedor, produto, cotacao e pedido deve ser restrita a `admin`, `financeiro` e roles de compras autorizadas.

Risco: alto, porque varios modulos dependem dessas tabelas.

### Etapa 5 — operacao diaria

Proteger:

- producao;
- sobras/descartes;
- romaneio;
- congelados;
- prateleira.

Regra alvo:

- limitar por role;
- limitar por loja quando a tabela tiver loja/origem/destino;
- reduzir `delete` e preferir status/cancelamento em fluxos futuros.

Risco: alto, porque sao telas usadas no dia a dia.

### Etapa 6 — aposentar `app_users`

Depois de alguns dias de uso estavel por e-mail + senha:

- remover dependencia do login por PIN;
- remover leitura anonima de `app_users`;
- reduzir grants de `app_users`;
- manter historico operacional sem expor PIN/roles antigas.

Risco: alto se feito cedo; baixo se todos ja estiverem usando e-mail/senha.

## O que nao foi feito nesta auditoria

- Nenhuma policy foi alterada.
- Nenhum grant foi alterado.
- RLS nao foi ligado/desligado em nenhuma tabela.
- Nenhuma migration foi aplicada.
- Nenhum usuario foi criado, removido ou editado.
- Nenhum profile foi criado, removido ou editado.
- Nenhum segredo foi lido em output ou gravado no repo.
- Nenhum arquivo de `src/` foi alterado.

## Proximo passo recomendado

Fazer a Etapa 1 como PR pequeno:

1. criar migration apenas para a funcao `set_app_profiles_updated_at`;
2. validar login por e-mail;
3. rodar advisors de seguranca;
4. se aprovado, aplicar e documentar.

Depois disso, iniciar a protecao das tabelas vazias de estoque antes de qualquer importacao XML ou entrada financeira sensivel.
