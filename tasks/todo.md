# TODO — Categoria + BOM (Bill of Materials)

**Objetivo:** habilitar CMV automático de kits (ex: "Kit Pão de Hamburguer" = 4 unidades de "Pão de Hamburguer") e baixa em cascata quando vende/descarta/expede kit. Pré-requisito real pra Fase 5 (CMV/Dashboard).

**Estado atual do banco:**
- `products.category` (text livre) — categoria visual (Bolos, Cookies, INSUMOS, etc.). **Preservar.**
- Não tem ligação Kit → breads/products componentes. Hoje é tudo manual.

**Decisão de arquitetura:**
- Adicionar coluna **`kind`** em products: enum `'kit' | 'insumo' | 'final'`. Ortogonal a `category`.
- Tabela **`product_components`** liga 1 product (kind=kit) a N (breads ou products).
- Baixa em cascata fica **client-side no momento do save** (consistente com o resto do código — sem triggers obscuros). Trigger no banco vira opção futura se aparecer call site novo.
- CMV computado é **sugestão** ao lado do `cost_price` manual — não substitui. Admin escolhe se aceita.

---

## Fase A — Schema + categoria UI (sem impacto operacional)

- [x] **A1** — Migration: `ALTER TABLE products ADD COLUMN kind text CHECK (kind IN ('kit','insumo','final'))`. Heurística refinada (KIT KAT BRANCO e Kit 5 macarrons eram falsos positivos com `Kit %`; ajustada pra `Kit Pão %`):
  - nome ILIKE 'Kit Pão %' OR 'Kit Pao %' → 'kit' (3 itens: Abobora, Caserinho, mandioquinha)
  - category = 'INSUMOS' → 'insumo' (256 itens)
  - resto → 'final' (159 itens)
  - Index `idx_products_kind` criado. database.types.ts regenerado.
- [x] **A2** — `/produtos`: chip `ps-store-chip` ao lado do nome (jc/honey=KIT, ja/sage=INSUMO; finais sem chip pra reduzir ruído). Filtro de presets "Todos / Kits (N) / Insumos (N) / Finais (N)" + filtro de categoria preservado. Botão "Composição" (ícone Layers) em kit, desabilitado com tooltip "chega na Fase B". Modal de edit ganha select "Tipo" (kit/insumo/final). Novo produto entra como 'final' por default.

**Saída da fase A:** ninguém precisa de comportamento novo. Só ganham visibilidade dos kinds.

---

## Fase B — BOM read-only + CMV sugerido

- [x] **B1** — Migration aplicada: `product_components` com colunas:
  - `id` uuid PK
  - `parent_product_id` uuid → products.id ON DELETE CASCADE
  - `component_source` text ('bread' | 'product')
  - `component_id` text (uuid p/ product, slug p/ bread)
  - `quantity` numeric (default 1)
  - `created_at` timestamptz default now()
  - UNIQUE (parent_product_id, component_source, component_id)
- [x] **B2** — `/produtos/composicao?id=<uuid>` (query param em vez de dynamic route — combina com padrão estático do app). Lista componentes com chip PÃO/PRODUTO e custo; edit inline de quantidade (blur salva); remoção com confirm. Busca de bread/produto filtra kits, self, ativos, e já-adicionados. Sumário "CMV computado" no final, com aviso se algum componente sem custo. Read-only se kind != 'kit' (banner + inputs disabled). Botão 📋 em /produtos vira <Link> pra essa tela.
- [x] **B3** — Em `/produtos` aba Produtos, mostrar "CMV computado: R$ X" verde-sage abaixo do cost_price manual nos kits que têm components. Cálculo: Σ (componente.cost_price × quantity). Se algum componente sem custo, badge "(parcial)" em berry. Contador de componentes no fim ("· N comp."). Aba Pães intacta (pães não têm kind, não há kit pra computar).

**Saída da fase B:** kits ganham composição visível e CMV sugerido. Ainda nada muda no fluxo operacional.

---

## Fase C — Baixa em cascata (impacto operacional, mais arriscado)

- [ ] **C1** — `/sobras`: ao gravar sobra/descarte de um item com `kind='kit'`, expandir pra components:
  - Continuar gravando o row em `sobras`/`descartes` do kit (pra histórico/relatório)
  - **Adicionalmente** gravar N rows extras em `bread_movements` ou `stock_movements` (cada component × quantity × qty do kit)
  - Tag `reference_type='kit_cascade'` pra rastrear origem
- [ ] **C2** — `/romaneio` (envio): ao confirmar envio de um kit, igual ao C1 — debita components do estoque da loja origem em `bread_movements` (loja de origem).
- [ ] **C3** — Auditoria: SQL pra ver se há kits hoje com `kind='kit'` SEM components cadastrados. Avisar admin/financeiro pra cadastrar antes da Fase C entrar em produção (senão silenciosamente nada muda).

**Saída da fase C:** estoque de pães fica consistente com venda de kits. Habilita relatório de "consumo real de pão por kit/dia".

---

## Fora deste escopo (futuro)

- Trigger no banco pra baixa em cascata (alternativa server-side).
- Substituir `cost_price` manual por computed column. Mantém manual como fallback por enquanto.
- BOM aninhado (kit que contém kit). Por ora, components são só bread ou product final/insumo.
- Tela de inventário (`/estoque/inventario`) — separado, fica como TODO próprio.

---

## Validação antes de codar

**Decisões que preciso confirmar com o Rodrigão:**
1. Topo do iceberg: começo pela Fase A só (sem comprometer com B/C ainda)? Ou plano e executo tudo?
2. Baixa em cascata: client-side OK ou prefere trigger no banco?
3. `cost_price` manual vs. computado: mantém manual como fallback OK?
4. Filtro `INSUMO` em `/estoque/entrada` e `/compras`: aplicar nesta sequência (depois de A1) ou deixar pra TODO separado?
