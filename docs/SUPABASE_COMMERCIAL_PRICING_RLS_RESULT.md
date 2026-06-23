# Resultado - hardening RLS de clientes e tabelas de preco

Data: 2026-06-23
Branch: `codex/rls-public-tables-next-batch`
Migration: `20260623195005_harden_commercial_pricing_rls.sql`

## Objetivo

Remover acesso anonimo permissivo do grupo comercial usado por clientes PJ, encomendas, pedidos PJ, tabelas de preco e simulador de desconto.

Tabelas tratadas:

- `public.customers`
- `public.price_tiers`
- `public.price_tier_items`
- `public.customer_price_overrides`

## Contexto antes da alteracao

Auditoria live confirmou:

- as quatro tabelas ja tinham RLS ligado;
- as quatro tabelas mantinham policies permissivas para `anon`;
- as quatro tabelas tinham grants amplos para `anon`, `authenticated` e `service_role`;
- existiam dados reais no grupo:
  - `customers`: 30 registros;
  - `price_tiers`: 16 registros;
  - `price_tier_items`: 58 registros;
  - `customer_price_overrides`: 1 registro.

Tambem foi confirmado que 3 perfis ativos de `vendas` possuem rota `/encomendas`. Por isso, a policy de `customers` preserva leitura de clientes ativos para `vendas`.

## Alteracao aplicada

A migration:

- habilita RLS nas quatro tabelas;
- remove todos os grants de `anon`;
- remove policies antigas `anon_select`, `anon_insert` e `anon_update`;
- reduz grants de `authenticated` para `SELECT`, `INSERT` e `UPDATE`;
- preserva acesso total para `service_role`;
- cria policies novas baseadas em `public.app_profiles`.

## Modelo de acesso resultante

`customers`:

- `admin` e `financeiro` podem ler, inserir e atualizar;
- `vendas` pode ler somente clientes ativos;
- demais perfis nao acessam.

`price_tiers`, `price_tier_items` e `customer_price_overrides`:

- `admin` e `financeiro` podem ler, inserir e atualizar;
- demais perfis nao acessam.

Nenhuma dessas tabelas recebeu permissao de `DELETE` para `authenticated`. O app usa inativacao por `UPDATE`, preservando historico.

## Validacao live apos aplicar

Consulta de conferencia executada no Supabase confirmou:

- RLS ligado nas quatro tabelas;
- ausencia de grants para `anon`;
- grants de `authenticated` limitados a `INSERT`, `SELECT` e `UPDATE`;
- ausencia das policies antigas `anon_*`;
- migration registrada no historico remoto como `20260623195005_harden_commercial_pricing_rls`;
- contagens preservadas:
  - `customers`: 30;
  - `price_tiers`: 16;
  - `price_tier_items`: 58;
  - `customer_price_overrides`: 1.

Teste de leitura por perfil autenticado:

| Perfil simulado | customers | price_tiers | price_tier_items | customer_price_overrides |
| --- | ---: | ---: | ---: | ---: |
| `admin` | 30 | 16 | 58 | 1 |
| `financeiro` | 30 | 16 | 58 | 1 |
| `vendas` | 30 | 0 | 0 | 0 |
| `producao` | 0 | 0 | 0 | 0 |

## Impacto esperado

Usuarios por e-mail com perfil ativo continuam acessando conforme o cargo.

O fluxo anonimo/PIN nao deve mais ler nem escrever esse grupo de tabelas comerciais. Isso e intencional para reduzir exposicao de clientes PJ, tabelas de preco e descontos.

## Risco residual

Esta alteracao cobre apenas clientes e tabelas de preco. Ainda existem tabelas publicas com RLS desligado ou policies anonimas permissivas, especialmente `products`, `suppliers`, `sobras`, `descartes`, compras, pedidos e producao.
