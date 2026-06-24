# 07 — Planejamento: unificação de `breads` e `products`

Data: 2026-06-24

Status: planejamento. Não executar migração ainda.

## Objetivo

Unificar o cadastro de itens vendáveis, fabricados, comprados, kits, insumos e revenda em uma fonte principal: `products`.

Hoje o ERP trata `breads` e `products` como entidades diferentes. Isso funcionou para colocar a operação no ar, mas começa a atrapalhar a evolução para ficha técnica, CMV, importação de vendas CNM e margem por produto.

Decisão proposta:

> Todo item do negócio deve ser um produto. Pão é um produto de fabricação própria, não uma entidade separada.

## Por que isso importa para o CMV

Para calcular CMV confiável, o ERP precisa cruzar:

- produto vendido;
- ficha técnica;
- custo dos insumos;
- produção realizada;
- sobras e descartes;
- preço de venda;
- canal e loja.

Com `breads` e `products` separados, cada tela precisa decidir se está lidando com `product_source = bread` ou `product_source = product`. Isso espalha regra duplicada e aumenta risco de erro.

Exemplo prático: a ficha técnica criada para `products` não funciona naturalmente para pães, porque `product_components.parent_product_id` aponta para `products`, não para `breads`.

## Estado atual

### `breads`

Usada principalmente para:

- pedidos de produção diária;
- dias de produção (`days`);
- forno e produção real;
- estoque/movimentação de pães (`bread_movements`);
- sobras e descartes de pão;
- romaneio;
- pedidos PJ e encomendas quando o item é pão;
- preço de produtos PJ quando `product_source = bread`.

### `products`

Usada principalmente para:

- catálogo geral;
- insumos;
- produtos finais;
- kits;
- revenda;
- itens de prateleira;
- composição de kits em `product_components`;
- entrada de estoque de insumos;
- compras e fornecedores;
- parte dos pedidos PJ, tabelas de preço, sobras e romaneio.

### Problema de desenho

O sistema tem dois catálogos vivos e várias telas juntam os dois manualmente.

Isso cria perguntas ruins:

- Um pão pode ter ficha técnica?
- Um pão é produto para venda CNM?
- Um pão pode ser revenda?
- Um produto final pode aparecer no forno?
- Como comparar margem se parte está em `breads` e parte em `products`?

A resposta ideal é: tudo isso deve estar em uma entidade única.

## Modelo alvo

`products` vira o catálogo único.

Campos conceituais desejados:

| Campo | Sentido |
| --- | --- |
| `kind` | Tipo principal: `final`, `insumo`, `kit` |
| `is_fabricacao_propria` | Item produzido internamente |
| `is_revenda` | Item comprado pronto para revenda |
| `is_shelf` | Item de prateleira/durado |
| `is_pj` | Item disponível no catálogo PJ |
| `production_days` | Dias da semana em que aparece na produção |
| `production_area` | Padaria, cozinha, confeitaria etc. |
| `legacy_bread_id` | Vínculo temporário com `breads` durante migração |

Observação: nomes finais de colunas devem ser definidos em migration específica. Este documento não é a migration.

## Regras de negócio propostas

1. Pão comum:
   - `kind = final`
   - `is_fabricacao_propria = true`
   - `is_revenda = false`
   - tem `production_days`
   - pode ter ficha técnica

2. Produto de confeitaria feito internamente:
   - `kind = final`
   - `is_fabricacao_propria = true`
   - pode ou não ter `production_days`
   - pode ter ficha técnica

3. Insumo:
   - `kind = insumo`
   - `is_fabricacao_propria = false`
   - entra em compras e estoque
   - entra como componente de ficha técnica

4. Revenda:
   - `is_revenda = true`
   - comprado pronto
   - não precisa de ficha técnica de produção
   - custo vem de compra/estoque ou custo manual

5. Kit:
   - `kind = kit`
   - composição aponta para produtos/componentes
   - baixa componentes conforme regra operacional

## Estratégia segura de migração

### Fase 0 — Documento e inventário

Objetivo: entender impacto antes de alterar banco.

Entregas:

- Este plano.
- Inventário de telas e tabelas que usam `breads`.
- Inventário de telas e tabelas que usam `product_source`.
- Lista de campos de `breads` que precisam existir em `products`.

Sem alteração remota.

### Fase 1 — Preparar `products`

Objetivo: permitir que `products` represente também os pães sem desligar `breads`.

Possíveis mudanças:

- adicionar `production_days`;
- adicionar `is_fabricacao_propria`;
- adicionar `is_pj`, se ainda não estiver consolidado;
- adicionar `legacy_bread_id`;
- avaliar `production_area`.

Cuidados:

- migration pequena;
- RLS revisada antes de uso;
- sem apagar dados;
- sem trocar telas operacionais ainda.

### Fase 2 — Backfill de pães para produtos

Objetivo: copiar cada registro de `breads` para `products`.

Regras:

- manter o mesmo nome visível;
- preservar unidade, custo, ativo/inativo, prateleira, PJ e dias de produção;
- preencher `legacy_bread_id`;
- evitar duplicidade por `legacy_bread_id`;
- gerar relatório de quantos foram migrados.

Importante: `breads` continua existindo e sendo usado pelas telas antigas.

### Fase 3 — Catálogo unificado

Objetivo: mudar `/produtos` para mostrar tudo a partir de `products`.

Mudança de UX:

- remover a lógica mental de "Produtos vs Pães";
- transformar a aba "Pães" em filtro de "Fabricação própria / Pães";
- botão "Ficha" passa a existir para qualquer produto fabricado;
- insumo e revenda continuam com tratamento próprio.

Esta fase ainda não precisa mudar Forno/Produção.

### Fase 4 — Ficha técnica única

Objetivo: ficha técnica funcionar para todo produto fabricado.

Possível evolução de schema:

- trocar `product_components` para um modelo mais geral de receita/ficha;
- avaliar `product_recipes` versionada, conforme `CMV_EXECUTION_PLAN.md`;
- incluir rendimento, perda técnica e embalagem futuramente.

Decisão importante:

`product_components` atual resolve kits simples, mas não é suficiente para CMV robusto. Para CMV, o ideal é evoluir para ficha técnica versionada.

### Fase 5 — Produção e forno

Objetivo: produção diária deixar de depender diretamente de `breads`.

Mudanças prováveis:

- `/` passa a listar produtos com `is_fabricacao_propria = true` e `production_days` compatíveis;
- `/forno` passa a carregar produtos fabricados, não `breads`;
- produção real referencia `product_id`;
- compatibilidade com registros antigos por `legacy_bread_id`.

Risco alto: esta fase afeta operação diária. Precisa de validação manual com Rodrigo antes de entrar na `main`.

### Fase 6 — Sobras, descartes, romaneio e estoque de pães

Objetivo: parar de tratar pão como exceção.

Mudanças prováveis:

- `bread_movements` pode evoluir para movimentos por produto fabricado;
- sobras/descartes deixam de ter lógica separada para `bread`;
- romaneio baixa produtos/componentes de forma consistente.

Esta fase deve ser feita depois de Produção/Forno, não antes.

### Fase 7 — Vendas CNM e aliases

Objetivo: importação CNM mapear tudo para `products`.

Regras:

- `sales_product_aliases.product_id` aponta para `products.id`;
- não criar alias para `breads`;
- manter compatibilidade apenas para dados históricos.

Isso reduz bastante a complexidade do CMV por produto.

### Fase 8 — Deprecar `breads`

Objetivo: parar escrita em `breads`.

Condições mínimas:

- produção funcionando por `products`;
- forno funcionando por `products`;
- sobras/descartes funcionando por `products`;
- romaneio funcionando por `products`;
- PJ/tabelas de preço funcionando por `products`;
- dados históricos consultáveis.

Não apagar a tabela imediatamente. Primeiro marcar como legado.

## O que não fazer agora

- Não criar `bread_components` só para resolver o botão "Ficha" em pães.
- Não duplicar ficha técnica em duas tabelas paralelas.
- Não apagar `breads`.
- Não migrar Forno e Produção no mesmo PR da mudança de catálogo.
- Não criar dashboard de CMV antes de estabilizar catálogo e ficha.

## Riscos

| Risco | Mitigação |
| --- | --- |
| Quebrar produção diária | migrar Produção/Forno em fase separada |
| Duplicar itens no catálogo | usar `legacy_bread_id` e relatório de backfill |
| Perder histórico | manter `breads` e `product_source` antigos como legado |
| Confundir equipe operacional | mudança gradual de UI, com filtros claros |
| CMV calcular errado | ficha técnica versionada antes de dashboard |

## Rollback mental

Até a Fase 3, rollback é simples:

- manter `breads` como fonte operacional;
- remover uso novo de `products` para pães;
- preservar dados copiados como inativos ou ignorados pela UI.

Depois que Produção/Forno migrar, rollback exige script de compatibilidade. Por isso essa fase deve ser separada e validada com cuidado.

## Primeira entrega recomendada

Criar um PR apenas de planejamento e inventário:

1. Documento atual.
2. Script ou relatório manual com:
   - quantos registros existem em `breads`;
   - quantos já parecem duplicados em `products`;
   - quais telas leem `breads`;
   - quais tabelas usam `product_source`.
3. Nenhuma migration aplicada.

Depois disso, decidir com Rodrigo a Fase 1.

## Decisão pendente

Antes de implementar a unificação, Rodrigo precisa confirmar:

1. `products` será a fonte única de catálogo?
2. `breads` será legado temporário?
3. A ficha técnica deve ser construída já pensando em versão/rendimento/perda?
4. A migração de Produção/Forno pode ser planejada como etapa separada e cuidadosa?

