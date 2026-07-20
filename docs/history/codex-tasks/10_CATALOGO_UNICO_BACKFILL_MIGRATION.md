# 10 — Catálogo único: migration de backfill `breads` → `products`

Data: 2026-06-24

Status: migration aplicada em produção em 2026-06-25.

## Objetivo

Preparar e registrar a aplicação da migration que vincula ou cria produtos a partir dos registros atuais de `public.breads`, avançando a unificação do catálogo.

Esta etapa deixou o SQL pronto para revisão e, após confirmação explícita de Rodrigo em 2026-06-25, a migration foi aplicada no Supabase de produção.

## Migration criada

Arquivo:

```text
supabase/migrations/20260624195513_backfill_products_from_breads.sql
```

## O que a migration fez

- Valida que os 41 registros esperados ainda existem em `public.breads`.
- Vincula 8 pães a produtos já existentes usando `products.legacy_bread_id`.
- Cria 33 produtos novos para pães sem equivalente claro.
- Marca todos os itens migrados como `is_fabricacao_propria = true`.
- Define `production_area = 'padaria'`.
- Copia `breads.days` para `products.production_days`.
- Copia `breads.is_pj` para `products.is_pj`.
- Mantém `public.breads` intacta.

## Regra de custo

Para reduzir risco de distorção no CMV:

- produto novo recebe `breads.cost_price`;
- produto existente com `cost_price` nulo ou zerado recebe `breads.cost_price`;
- produto existente com `cost_price` maior que zero mantém o custo atual.

Com isso, a migration não sobrescreve custos comerciais já preenchidos, mas corrige os produtos que hoje estão zerados.

## Categoria temporária

Os 33 produtos criados entram com:

```text
Pães - Migrado
```

Essa categoria é intencionalmente temporária. Ela facilita encontrar e revisar os itens depois, sem misturar automaticamente com categorias comerciais já usadas.

## Itens vinculados

Estes produtos já existem e serão apenas vinculados:

| Produto existente | `legacy_bread_id` |
| --- | --- |
| Belga | `belga1775678507408` |
| Ciabatta UN | `ciabatta1775678319364` |
| Cuca de Morango | `cuca_de_morango1775678950877` |
| Focaccia de Alecrim UN | `focaccia_de_alecrim1775678468584` |
| Focaccia de Queijo UN | `focaccia_de_queijo1775678478927` |
| Pão de Milho UN | `pao_de_milho1775678426513` |
| Pão de Sopa | `pao_de_sopa1778785206958` |
| Pão de Tapioca | `pao_de_tapioca1778572678568` |

## Itens criados

A migration cria produtos para os 33 pães sem equivalente claro:

```text
3 Cereais
B.Brasil
B.Brasil integral
Baguete
Brioche Forma
Brioche Hamburguer
Caseirinho
Cinnamon rolls
Croissant
Cuca de Banana
Gorgonzola
Grande Arome
Hambúrguer Italiano
Integral
Integral de Forma
Italiano
Italiano de Queijo e Oregano
Mandioquinha
Mini Croissant
Multi de Forma
Multigrãos
Pão de Alecrim
Pão de Abóbora (Baguetinha)
Pão de Azeitonas
Pão de Bacon
Pão de Batata Hamburguer
Pão de Calabresa
Pão de Hotdog
Pãozinho de Abóbora
Pizza Redonda
Pizza Romana
Rugbrod
Sarraceno
```

## Validações antes de aplicar

Antes de executar a migration em produção, foram rodadas consultas somente leitura para confirmar:

```sql
select count(*) as total_breads
from public.breads;

select count(*) as products_with_legacy_bread_id
from public.products
where legacy_bread_id is not null;

select count(*) as products_fabricacao_propria
from public.products
where is_fabricacao_propria = true;
```

Resultado antes da aplicação:

| Consulta | Resultado |
| --- | ---: |
| `total_breads` | 41 |
| `products_with_legacy_bread_id` | 0 |
| `products_fabricacao_propria` | 0 |

## Validações depois de aplicar

Depois da aplicação, foram validados:

```sql
select count(*) as migrated_products
from public.products
where legacy_bread_id is not null;

select category, count(*) as total
from public.products
where legacy_bread_id is not null
group by category
order by category;

select legacy_bread_id, count(*) as total
from public.products
where legacy_bread_id is not null
group by legacy_bread_id
having count(*) > 1;
```

Resultado:

| Validação | Resultado |
| --- | ---: |
| Total de `breads` | 41 |
| Total de `products` | 460 |
| Produtos com `legacy_bread_id` | 41 |
| Produtos com `is_fabricacao_propria = true` | 41 |
| Produtos na categoria `Pães - Migrado` | 33 |
| `legacy_bread_id` duplicado | 0 |
| Produtos migrados com `production_area = 'padaria'` | 41 |
| Produtos migrados com `production_days` válido | 41 |

Distribuição por categoria após aplicação:

| Categoria | Total |
| --- | ---: |
| Confeitaria | 1 |
| Focaccias | 2 |
| Pães - Migrado | 33 |
| Pães Branco | 2 |
| Pães Integ. | 1 |
| Pães Rech. | 2 |

## Rollback conceitual

Se a migration precisar ser revertida antes de qualquer tela depender dos novos vínculos:

1. Remover os 33 produtos criados com categoria `Pães - Migrado` e `legacy_bread_id` preenchido.
2. Limpar os campos novos dos 8 produtos vinculados:
   - `legacy_bread_id`;
   - `is_fabricacao_propria`;
   - `is_pj`;
   - `production_days`;
   - `production_area`.
3. Revisar manualmente custos de produtos que estavam zerados e receberam custo de `breads`.

Esse rollback não deve ser executado sem plano separado e aprovação explícita.

## O que esta PR não faz

- Não altera telas.
- Não altera `src/`.
- Não remove `breads`.
- Não muda RLS.
- Não muda pedidos, forno, sobras ou romaneio.

## Registro complementar

O resultado operacional da aplicação está registrado em `docs/SUPABASE_PRODUCTS_BACKFILL_APPLY_RESULT.md`.

## Próxima etapa recomendada

Depois desta aplicação, o próximo passo é ajustar as telas para consumir o catálogo unificado em `products`, sem depender de `breads` para novos fluxos de ficha técnica e CMV.
