# Resultado - hardening RLS das tabelas vazias de estoque

Data: 2026-06-23
Branch: `codex/stock-empty-tables-rls`
Migration: `20260623183709_harden_empty_stock_tables_rls.sql`

## Objetivo

Proteger as tabelas iniciais do fluxo de estoque antes de receberem dados reais.

Tabelas tratadas:

- `public.stock_entries`
- `public.stock_entry_items`
- `public.stock_balance`
- `public.stock_movements`

## Contexto antes da alteração

Auditoria live confirmou que as quatro tabelas estavam vazias.

Também foi identificado:

- `stock_entries`, `stock_entry_items` e `stock_balance` estavam com RLS desligado.
- `stock_movements` estava com RLS ligado, mas possuia policies permissivas para `anon`.
- As quatro tabelas tinham grants amplos para `anon`, `authenticated` e `service_role`.

## Alteração aplicada

A migration:

- habilita RLS nas quatro tabelas;
- remove todos os grants de `anon`;
- redefine grants de `authenticated` apenas para as operações usadas pelo fluxo;
- preserva acesso total para `service_role`;
- remove as policies permissivas `anon_select` e `anon_insert` de `stock_movements`;
- cria policies por role usando `public.app_profiles`.

## Modelo de acesso resultante

Leitura:

- `admin`
- `financeiro`
- `estoque`
- `compras`
- `expedicao`

Escrita:

- `admin`
- `financeiro`
- `estoque`
- `compras`

O cargo `expedicao` pode consultar estoque, mas nao registrar entrada/movimento.

## Validacao live apos aplicar

Consulta de conferencia executada no Supabase confirmou:

- as quatro tabelas continuam com `0` registros;
- RLS esta habilitado nas quatro tabelas;
- nao ha grants para `anon`;
- `authenticated` tem somente:
  - `SELECT, INSERT` em `stock_entries`;
  - `SELECT, INSERT` em `stock_entry_items`;
  - `SELECT, INSERT, UPDATE` em `stock_balance`;
  - `SELECT, INSERT` em `stock_movements`;
- nao restaram policies `anon_*` em `stock_movements`;
- a migration foi registrada no historico remoto como `20260623183709_harden_empty_stock_tables_rls`.

## Impacto esperado

O fluxo antigo por PIN/localStorage, quando usado como usuario anonimo, nao deve mais acessar essas tabelas de estoque.

Isso e intencional nesta etapa: as tabelas ainda estavam vazias e foram protegidas antes de receber dados operacionais ou financeiros.

## Risco residual

Esta alteracao cobre apenas as quatro tabelas vazias de estoque. A auditoria geral de RLS ainda aponta outras tabelas publicas que precisam ser tratadas em etapas separadas.
