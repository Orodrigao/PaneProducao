# 08 — Catálogo único: Fase 1 schema

Data: 2026-06-24

Status: concluída. Migration criada no repositório, aplicada em produção e marcada como aplicada no histórico remoto.

## Objetivo

Preparar `public.products` para representar também os itens que hoje vivem em `public.breads`, sem desligar `breads` e sem alterar telas operacionais.

Esta fase cria a base para a decisão:

> Pão é produto de fabricação própria, não uma entidade separada.

## Migration criada

Arquivo:

```text
supabase/migrations/20260624183056_prepare_products_unified_catalog.sql
```

## Campos adicionados em `products`

| Campo | Tipo | Uso |
| --- | --- | --- |
| `is_fabricacao_propria` | boolean | Marca produtos produzidos internamente |
| `is_pj` | boolean | Substituto futuro de `breads.is_pj` no catálogo único |
| `production_days` | integer[] | Substituto futuro de `breads.days` |
| `production_area` | text | Área responsável: padaria, cozinha, confeitaria, expedição ou outros |
| `legacy_bread_id` | text | Vínculo temporário com `breads.id` durante migração |

## Restrições e índices

A migration inclui:

- constraint para `production_days` aceitar apenas valores de 0 a 6;
- constraint para `production_area` aceitar apenas áreas previstas;
- índice único parcial em `legacy_bread_id`;
- índices auxiliares para produtos de fabricação própria e PJ;
- comentários nas colunas novas.

## O que esta fase não faz

- Não copia registros de `breads` para `products`.
- Não altera `/produtos`.
- Não altera `/`, `/forno`, `/sobras`, `/romaneio` ou `/pedidos-pj`.
- Não cria ficha técnica para pães ainda.
- Não remove `breads`.
- Não muda RLS.
- Não executa novas escritas remotas a partir deste documento.

## Por que começar por schema

Antes de mudar telas, `products` precisa conseguir armazenar as informações que só existem em `breads`.

Sem isso, qualquer botão "Ficha" em pães exigiria uma tabela paralela como `bread_components`, que reforçaria a divisão que queremos eliminar.

## Próxima fase recomendada

Fase 2 deve ser um backfill controlado:

1. Levantar quantos registros existem em `breads`.
2. Identificar duplicados prováveis em `products`.
3. Definir regra de criação ou vínculo.
4. Criar script/migration de backfill com `legacy_bread_id`.
5. Validar em SELECT antes de aplicar qualquer escrita remota.

A auditoria inicial dessa fase está documentada em `docs/codex-tasks/09_CATALOGO_UNICO_BACKFILL_AUDITORIA.md`.

## Risco

Baixo nesta fase porque a migration aplicada:

- só adiciona colunas com default;
- não remove coluna;
- não altera dados existentes;
- não altera telas.

O risco real começa na fase de backfill e nas telas operacionais de produção.
