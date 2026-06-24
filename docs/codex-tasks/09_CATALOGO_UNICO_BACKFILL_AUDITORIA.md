# 09 — Catálogo único: auditoria para backfill

Data: 2026-06-24

Status: auditoria concluída. Documento preparatório, sem escrita no Supabase.

## Objetivo

Auditar os dados atuais de `public.breads` e `public.products` antes de copiar ou vincular pães ao catálogo único em `products`.

Esta etapa prepara o backfill, mas não executa a migração dos dados.

## Escopo executado

- Consultas somente leitura no Supabase.
- Contagem de registros em `breads` e `products`.
- Identificação de pães com produto equivalente provável.
- Identificação de pães que precisam virar novos produtos.
- Proposta de regra segura para a próxima migration.

## O que esta etapa não fez

- Não criou produtos.
- Não atualizou produtos.
- Não alterou `breads`.
- Não alterou RLS.
- Não alterou telas.
- Não alterou `src/`.
- Não executou `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP` ou `TRUNCATE`.
- Não aplicou migration.

## Resumo dos dados

Consulta realizada em 2026-06-24.

| Métrica | Resultado |
| --- | ---: |
| Registros em `breads` | 41 |
| `breads` ativos | 41 |
| `breads.is_pj = true` | 2 |
| `breads.is_shelf = true` | 20 |
| Registros em `products` | 427 |
| `products.legacy_bread_id` preenchidos | 0 |
| `products.is_fabricacao_propria = true` | 0 |
| Vínculos prováveis por nome | 8 |
| Candidatos a criação em `products` | 33 |

## Vínculos prováveis

Estes itens de `breads` parecem já existir em `products`. A próxima etapa não deve criar novo produto para eles; deve vincular o produto existente via `legacy_bread_id`, se aprovado.

| Pão atual | Custo em `breads` | Produto provável | Categoria atual | Custo em `products` | Observação |
| --- | ---: | --- | --- | ---: | --- |
| Belga | 3.30 | Belga | Pães Rech. | 0.00 | Custo divergente; produto está zerado |
| Ciabatta | 0.45 | Ciabatta UN | Pães Branco | 0.60 | Custo divergente |
| Cuca de Morango | 9.00 | Cuca de Morango | Confeitaria | 10.00 | Custo divergente e categoria não é pão |
| Focaccia de Alecrim | 7.00 | Focaccia de Alecrim UN | Focaccias | 5.00 | Custo divergente |
| Focaccia de Queijo | 9.00 | Focaccia de Queijo UN | Focaccias | 9.50 | Custo divergente |
| Pão de Milho | 2.00 | Pão de Milho UN | Pães Branco | 2.00 | Custo igual |
| Pão de Sopa | 0.80 | Pão de Sopa | Pães Rech. | 0.00 | Custo divergente; produto está zerado |
| Pão de Tapioca | 1.10 | Pão de Tapioca | Pães Integ. | 0.00 | Custo divergente; produto está zerado |

## Candidatos a criação

Estes pães não tiveram produto equivalente provável encontrado.

| Pão | Unidade | Custo | PJ | Prateleira | Dias de produção |
| --- | --- | ---: | --- | --- | --- |
| 3 Cereais | un | 2.50 | não | sim | `[2]` |
| B.Brasil | un | 0.43 | não | sim | `[1,2,3,4,5,6]` |
| B.Brasil integral | un | 0.70 | não | sim | `[1,2,3,4,5,6]` |
| Baguete | un | 0.75 | não | não | `[1,2,3,4,5,6]` |
| Brioche Forma | un | 2.10 | não | sim | `[1,2,3,4,5,6]` |
| Brioche Hamburguer | un | 0.75 | não | sim | `[1,2,3,4,5,6]` |
| Caseirinho | un | 0.30 | não | sim | `[0,1,2,3,4,5,6]` |
| Cinnamon rolls | un | 0.90 | não | não | `[1,2,3,4,5,6]` |
| Croissant | un | 1.10 | não | não | `[1,2,3,4,5,6]` |
| Cuca de Banana | un | 8.00 | não | sim | `[4,5,6]` |
| Gorgonzola | un | 8.25 | não | não | `[4,5,6]` |
| Grande Arome | un | 2.30 | não | não | `[2]` |
| Hambúrguer Italiano | un | 0.35 | sim | sim | `[0,1,2,3,4,5,6]` |
| Integral | un | 1.50 | não | não | `[1,2,3,4,5,6]` |
| Integral de Forma | un | 2.50 | não | sim | `[1,2,3,4,5,6]` |
| Italiano | un | 0.80 | não | não | `[1,2,3,4,5,6]` |
| Italiano de Queijo e Oregano | un | 4.50 | não | não | `[5,6]` |
| Mandioquinha | un | 0.46 | não | sim | `[0,3]` |
| Mini Croissant | un | 0.20 | não | sim | `[1,2,3,4,5,6]` |
| Multi de Forma | un | 3.30 | não | sim | `[1,2,3,4,5,6]` |
| Multigrãos | un | 3.30 | não | não | `[1,2,3,4,5,6]` |
| Pão de Alecrim | un | 1.10 | não | não | `[4,5,6]` |
| Pão de Abóbora (Baguetinha) | un | 0.45 | sim | sim | `[0,1,2,3,4,5,6]` |
| Pão de Azeitonas | un | 4.31 | não | não | `[1,2,3,4,5,6]` |
| Pão de Bacon | un | 2.70 | não | não | `[5,6]` |
| Pão de Batata Hamburguer | un | 0.85 | não | sim | `[4,5,6]` |
| Pão de Calabresa | un | 6.00 | não | não | `[4,5,6]` |
| Pão de Hotdog | Un | 0.45 | não | sim | `[0,1,2,3,4,5,6]` |
| Pãozinho de Abóbora | un | 0.35 | não | não | `[0,1,2,3,4,5,6]` |
| Pizza Redonda | un | 0.50 | não | não | `[1,2,3,4,5,6]` |
| Pizza Romana | un | 0.70 | não | não | `[1,2,3,4,5,6]` |
| Rugbrod | un | 3.30 | não | sim | `[1,2,3,4,5,6]` |
| Sarraceno | un | 3.30 | não | não | `[1]` |

## Regra recomendada para a próxima fase

Criar uma migration de backfill separada, revisável, com duas partes.

### Parte 1 — vincular produtos existentes

Para os 8 vínculos prováveis:

- preencher `products.legacy_bread_id`;
- marcar `products.is_fabricacao_propria = true`;
- copiar `breads.is_pj` para `products.is_pj`;
- copiar `breads.days` para `products.production_days`;
- preservar `products.category`, `products.kind` e `products.name`;
- não sobrescrever custo quando `products.cost_price` já for maior que zero;
- quando `products.cost_price = 0`, usar o custo de `breads` somente se Rodrigo aprovar essa regra.

### Parte 2 — criar produtos faltantes

Para os 33 candidatos:

- inserir em `products` com `legacy_bread_id = breads.id`;
- copiar `name`, `unit`, `cost_price`, `active`, `is_shelf`, `is_pj` e `days`;
- marcar `is_fabricacao_propria = true`;
- usar `kind = 'final'`;
- usar uma categoria temporária clara, por exemplo `Pães - Migrado`, até revisão operacional;
- não apagar nem alterar registros em `breads` nesta fase.

## Pontos que precisam de decisão do Rodrigo

Antes de escrever a migration de backfill, confirmar:

1. Se a categoria temporária `Pães - Migrado` pode ser usada para os 33 itens novos.
2. Se produtos existentes com custo zerado devem receber o custo vindo de `breads`.
3. Se produtos existentes com custo diferente de `breads` devem manter o custo atual e ir para revisão manual.
4. Se `production_area` deve ficar `padaria` para todos estes itens nesta primeira migração.

## Riscos

- Produto com mesmo nome pode representar uma venda/cadastro comercial e não exatamente o item de produção.
- Custos divergentes podem afetar CMV se forem sobrescritos sem revisão.
- Categoria temporária precisa ser revisada depois para não bagunçar filtros comerciais.
- `breads` ainda precisa continuar funcionando até as telas operacionais migrarem para `products`.

## Próxima etapa recomendada

Criar uma migration de backfill sem aplicar automaticamente.

A entrega dessa próxima etapa deve conter:

- SQL com `UPDATE` para os 8 vínculos prováveis;
- SQL com `INSERT` para os 33 produtos faltantes;
- consultas de validação antes/depois;
- rollback conceitual;
- pedido de aprovação explícita antes de qualquer escrita remota.
