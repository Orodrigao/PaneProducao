# Resultado — Identidade dos pedidos PJ e encomendas

Data: 2026-07-20

Status: aplicado em produção.

## Confirmação

Depois de receber o resumo do impacto e do risco, Rodrigo autorizou
explicitamente a aplicação respondendo:

```text
sim
```

## Migration aplicada

Projeto Supabase:

```text
PanePedidosLojas — gohluceldchoitihrimw
```

Arquivo versionado:

```text
supabase/migrations/20260720230027_adicionar_identidade_cancelamento_pedidos.sql
```

Hash SHA-256 do arquivo aplicado:

```text
d1c9bbcf650b77d2e813a18a3c4112ae31263be1fe09a1b4c2a69497b6514eca
```

A aplicação foi feita pelo Supabase MCP e ficou registrada no histórico
remoto como:

| Versão | Nome |
| --- | --- |
| `20260720235849` | `adicionar_identidade_cancelamento_pedidos` |

O timestamp remoto difere do nome do arquivo local porque o Supabase MCP
gera a versão no momento da aplicação.

## Resultado validado

- `public.orders.order_group_id` existe como `uuid` anulável;
- `cancelled_at`, `cancelled_by` e `cancel_reason` existem e continuam
  anuláveis;
- 116 linhas PJ receberam identidade, formando 49 grupos;
- 10 linhas de encomendas receberam identidade, formando 3 grupos;
- nenhuma linha PJ ou encomenda ficou sem `order_group_id`;
- nenhum pedido diário (`order_type = 'producao'`) recebeu identidade;
- o índice parcial `orders_order_group_id_idx` existe;
- RLS permaneceu habilitado em `public.orders`;
- a Data API reconheceu a nova coluna no cache do schema;
- nenhuma policy, permissão ou usuário foi alterado.

## Fora do escopo

- Nenhum pedido de teste foi criado ou editado durante a aplicação.
- Os alertas gerais do Security Advisor já existentes não foram corrigidos
  junto desta migration.
- O botão de cancelamento e os filtros de pedidos cancelados pertencem à
  Fase 2.
