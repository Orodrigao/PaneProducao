# Resultado — Backfill de `breads` para `products`

Data: 2026-06-25

Status: aplicado em produção.

## Confirmação

Rodrigo confirmou explicitamente a aplicação:

```text
Confirmo aplicar a migration 20260624195513_backfill_products_from_breads.sql no Supabase de produção.
```

## Migration aplicada

```text
supabase/migrations/20260624195513_backfill_products_from_breads.sql
```

Hash SHA-256 do arquivo aplicado:

```text
539af0c307bd2cb6f1d870e0bdc9f3f2d8b1da8d304950891d4b982712264122
```

## Método

A migration foi aplicada com o CLI explícito do Supabase no checkout WSL:

```text
/home/rodri/.supabase/bin/supabase db query --linked --file supabase/migrations/20260624195513_backfill_products_from_breads.sql
```

Depois, o histórico remoto foi marcado como aplicado:

```text
/home/rodri/.supabase/bin/supabase migration repair --linked --status applied 20260624195513
```

O histórico remoto confirmou:

| Versão | Nome |
| --- | --- |
| `20260624195513` | `backfill_products_from_breads` |

## Validação antes da aplicação

| Métrica | Resultado |
| --- | ---: |
| `breads` totais | 41 |
| `products` totais | 427 |
| `products.legacy_bread_id` preenchidos | 0 |
| `products.is_fabricacao_propria = true` | 0 |
| IDs esperados de `breads` encontrados | 41 |
| IDs esperados de `products` encontrados para vínculo | 8 |
| Produtos em `Pães - Migrado` antes | 0 |

## Validação depois da aplicação

| Métrica | Resultado |
| --- | ---: |
| `breads` totais | 41 |
| `products` totais | 460 |
| Produtos migrados com `legacy_bread_id` | 41 |
| Produtos com `is_fabricacao_propria = true` | 41 |
| Produtos em `Pães - Migrado` | 33 |
| `legacy_bread_id` duplicados | 0 |
| Produtos migrados com `production_area = 'padaria'` | 41 |
| Produtos migrados com `production_days` válido | 41 |

Distribuição dos 41 produtos migrados por categoria:

| Categoria | Total |
| --- | ---: |
| Confeitaria | 1 |
| Focaccias | 2 |
| Pães - Migrado | 33 |
| Pães Branco | 2 |
| Pães Integ. | 1 |
| Pães Rech. | 2 |

## Observações

- `public.breads` não foi alterada pela migration.
- Nenhuma tela foi alterada nesta etapa.
- Nenhuma policy de RLS foi alterada nesta etapa.
- A migration criou 33 produtos novos e vinculou 8 produtos existentes.
- O comando `supabase migration list --linked` demorou e estourou tempo, então a confirmação do histórico foi feita por consulta direta em `supabase_migrations.schema_migrations`.

## Próximo passo

Com o backfill aplicado, a próxima etapa técnica é ajustar as telas para consumir `products` como catálogo único, mantendo `breads` apenas como legado até a retirada segura.
