# Resultado - correcao RLS de pedidos para usuarios Auth

Data: 2026-06-24
Branch: `codex/orders-authenticated-rls-fix`
Migration: `20260624151146_add_authenticated_orders_rls_policies.sql`

## Bug reportado

Na tela `Pedidos PJ`, a Elis tentou salvar um pedido e recebeu:

```text
new row violates row-level security policy for table "orders"
```

## Causa

A tabela `public.orders` estava com RLS ligado, mas possuia somente policies antigas para o role `anon`.

Quando a Elis entra por e-mail, o Supabase usa o role `authenticated`. Como nao havia policy para `authenticated`, o insert em `orders` era bloqueado.

## Alteracao aplicada

A migration adiciona policies para `authenticated` em `public.orders`, sem remover as policies antigas de `anon`.

Isso preserva o fluxo legado por PIN enquanto libera o fluxo novo por e-mail/Auth.

## Modelo de acesso resultante

Leitura:

- qualquer usuario autenticado com `app_profiles.active = true`.

Insert, update e delete:

- `admin`;
- `financeiro`;
- `vendas` somente quando `order_type = 'encomenda'`.

Essa regra libera a Elis, que e `financeiro`, para criar e editar pedidos PJ.

## Validacao live

Foi executada uma simulacao da Elis como usuario `authenticated`:

- insert em `orders` com `order_type = 'pj'`;
- update da linha de teste;
- delete da linha de teste;
- rollback da transacao.

Resultado:

- operacoes passaram pela RLS;
- nenhuma linha de teste ficou gravada;
- contagem permaneceu:
  - total de pedidos: 3434;
  - pedidos PJ: 52;
  - linhas de teste rollback: 0.

Tambem foi confirmado:

- grant de `authenticated` reduzido para `DELETE`, `INSERT`, `SELECT` e `UPDATE`;
- quatro policies novas para `authenticated`;
- quatro policies antigas de `anon` ainda presentes para preservar o fallback por PIN;
- migration registrada no historico remoto como `20260624151146_add_authenticated_orders_rls_policies`.

## Risco residual

As policies antigas de `anon` em `orders` continuam permissivas. Isso e intencional nesta correcao emergencial para nao quebrar o fluxo legado por PIN, mas deve ser tratado em uma etapa propria quando o login por e-mail estiver consolidado para todos os operadores.
