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

## Fase C — Baixa em cascata (descarte + romaneio + venda)

**Modelo confirmado com Rodrigão:** kit = estado intermediário "prateleira". Sobra ≠ baixa (pão tá lá, vai vender amanhã ou virar descarte). Só **descarte**, **romaneio** e **venda** (PJ/encomendas) fazem baixa real dos pães-componentes.

- [ ] **C1 — Descarte cascade** — `/sobras` modo descarte: ao gravar descarte de produto com `kind='kit'`, debitar pães-componentes do estoque da loja (em `bread_movements` com `reference_type='descarte_kit'`). Multiplicação: `qty_kit × qty_componente`. Idempotência: limpar movimentos antigos de `descarte_kit` junto com `descarte`. Componentes do tipo `product` (não-pão) ficam fora desta fase — só pão cascateia (alinhado com o modelo do negócio).
- [x] **C2 — Romaneio cascade** — `/romaneio` confirmar envio: itens com `product_source!='bread'` e cujo produto é `kind='kit'` agora cascateiam — pra cada componente-pão, gera par de bread_movements `-central/+destino` multiplicado por `qty_sent × qty_componente`. `reference_type='romaneio_kit'` separa da cascata direta. Idempotência amplia o gate pra cobrir os 2 tipos. No-op em romaneios sem kits.
- [~] **C3 — Vendas cascade** — Pulado de propósito. Pedidos PJ/encomendas hoje não movem estoque (só inserem em `orders`); a baixa real acontece quando o romaneio é gerado pra entregar pro cliente. Como C2 já cobre o romaneio, não precisa duplicar a cascata no save do pedido. Se um dia a operação mudar (entrega direta sem passar por romaneio), reabre.
- [x] **C4 — Auditoria pré-rollout** — Snapshot do banco (30/05): Kit Baguete Brasil tem 1 componente (CMV R$ 1.72) ✅. Os outros 3 (Abobora, Caserinho, mandioquinha) ainda estão vazios — cascade vira no-op até alguém cadastrar componentes em cada um via /produtos/composicao. Cascade roda safe em produção, sem efeito até cadastro.

**Saída da fase C:** estoque de pão reflete consumo real via kits. Habilita relatório "consumo de pão por kit/dia/loja".

**Cada subfase = 1 PR.** Mesclo só depois de teste em preview.

---

## Fase E — Revenda + filtro INSUMO em /compras e /estoque/entrada

- [x] **E** — Coluna nova `is_revenda` boolean em products (default false, NOT NULL, com index parcial WHERE true). Dimensão ortogonal a `kind`. Bombom e similares marcam-se manualmente em /produtos.
  - `/produtos` ganha: chip 🛒 REVENDA no card (cor crust), preset "🛒 Revenda (N)" no filtro de kinds, checkbox no modal de edit.
  - `/compras` e `/estoque/entrada` filtram a lista de produtos disponíveis: só `kind='insumo' OR is_revenda=true`. Kits e finais não-revenda somem dessas duas telas.
  - Sem backfill — user marca manualmente.

**Saída**: catálogo de compras fica limpo (só matéria-prima + revenda), e revenda vira dimensão de primeira classe no cadastro.

---

## Fase Cotação — Cotação semi-automática de compras (em andamento)

Spec recebida do Rodrigão (Claude.ai); adaptada pro projeto:
- Nomenclatura inglesa snake_case (não pt-BR como spec original).
- Reusa `suppliers` (não cria `fornecedores`).
- Renomeia `pedidos_compra` → `supplier_orders` pra não conflitar com `purchase_lists/items` (Lista Semanal já existente).
- Fotos de produto fora do escopo (não tem infra de Storage).
- Edge Function pra parse de respostas via Gemini Flash (`GEMINI_API_KEY` em Supabase Secrets).
- Send abstraction (`sendQuotation(supplier, message)`) — hoje gera link `wa.me`, futuro plug-in API.

- [x] **F1 — Schema** — Migration: `suppliers.whatsapp_e164` + `.telegram_handle`; tabelas `supplier_products`, `quotations`, `quotation_items`, `quotation_suppliers`, `quotation_responses`, `supplier_orders`, `supplier_order_items`. FKs + UNIQUEs + indexes + RLS `anon all access`. database.types.ts regenerado.
- [x] **F2 — Mapeamento supplier↔product** — `/fornecedores`: cada card ganha botão "Produtos (N)" que abre sheet com listagem do que tá cadastrado + busca pra adicionar (filtra kind=insumo OR is_revenda, exclui já-mapeados). Modal de edit ganha campos WhatsApp E.164 + Telegram handle. Sem rota nova — tudo via sheets como o resto do app.
- [x] **F3 — Geração de cotação** — Vista admin de `/compras` ganha botão "📋 Gerar cotação das listas enviadas". Agrega items de TODAS as listas `submitted`/`completed` por product_id (somando quantidades quando 2 setores pediram o mesmo produto), cria `quotations` + `quotation_items` + `quotation_suppliers` populado via `supplier_products`. Toast mostra contagens incluindo "N sem fornecedor" (órfãos). Mensagem por fornecedor (`generated_message`) fica nula até F4.
- [x] **F4 — Envio WhatsApp** — `src/lib/quotations.ts` com `buildQuotationMessage()` + `buildWhatsAppLink()` isolando o envio. `/cotacoes` lista (cards com contagens + status). `/cotacoes/detalhe?id=<uuid>` (query param, padrão estático): bloco vermelho "Sem fornecedor — mapear" no topo pros órfãos, depois 1 card por fornecedor com textarea editável da mensagem (onBlur persiste em quotation_suppliers.generated_message), botão "Abrir no WhatsApp" que abre wa.me + marca sent_at + status='sent'. Link "Ver cotações criadas" no /compras admin.
- [x] **F5 — Edge Function + Lançamento de respostas** — `supabase/functions/parse-cotacao/index.ts` deployada (gemini-2.5-flash, prompt forçando `application/json`, sanitização do payload no servidor). Cada card de fornecedor ganha textarea + botão "Extrair preços com IA" + grid editável (dropdown de produto, preço, unit, disponível, notes, remover linha) → upsert em `quotation_responses` (UNIQUE quotation+supplier+product). Card mostra "Respostas salvas" acima do form quando já tem. quotation_suppliers.status vai pra 'responded' e quotations.status sobe pra 'responded' no save. `tsconfig` exclui `supabase/functions` (Deno globals).
- [ ] **F6 — Comparativo + Pedido** — Matriz produto×fornecedor com destaque do menor preço; checkbox por linha; "Gerar pedido" cria `supplier_orders` + `supplier_order_items` por fornecedor escolhido. Cotação vira `closed`.

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
