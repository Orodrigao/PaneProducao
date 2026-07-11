# TASKS — ERP Pane & Salute
**Última atualização:** Julho 2026

Arquivo de acompanhamento de tarefas ativas e pendentes. Atualizar sempre que uma tarefa for iniciada ou concluída.

---

## 🔄 Em andamento — Sobras por lote e reaproveitamento JC/JA

- [x] Central mobile-first em `/sobras/pendencias`, com saldo, lote, idade e local físico.
- [x] Destinos parciais: vitrine, consumo interno, doação, descarte e congelamento.
- [x] Proposta no planejamento e confirmação física antes de reduzir o previsto do Forno.
- [x] Histórico imutável e funções transacionais com RLS; EX excluída do fluxo.
- [x] Testes, typecheck, lint, build e verificação visual mobile.
- [x] Migração aplicada no Supabase após aprovação explícita; fluxo transacional completo validado com rollback.
- [ ] Publicar a interface na `main` e validar o primeiro lançamento operacional.

---

## ✅ Concluído

### Módulos originais (Fase 0)
- [x] Pedidos de Produção (`/`)
- [x] Sobras e Descartes (`/sobras`)
- [x] Romaneio de Expedição (`/romaneio`)
- [x] Catálogo de Produtos (`/produtos`)
- [x] Estoque Congelado (`/estoque-congelado`)
- [x] Lista de Compras com notificação Telegram (`/compras`)

### Fase 1 — Estoque de Insumos
- [x] Tabelas no Supabase: `suppliers`, `stock_entries`, `stock_entry_items`, `stock_balance`, `stock_movements`
- [x] Tela `/estoque` — saldo atual com custo médio, filtro, busca, agrupamento por categoria
- [x] Tela `/estoque` → aba Saída/Baixa — baixa de insumo com motivo, responsável e notas
- [x] Tela `/estoque` → aba Movimentações — relatório com filtro por tipo e período
- [x] Tela `/estoque/entrada` — registrar compra de insumo
- [x] Tela `/fornecedores` — cadastro de fornecedores

### Infraestrutura
- [x] Migração de HTML puro para Next.js + TypeScript
- [x] Deploy na Vercel (`pane-producao.vercel.app`)
- [x] Repositório GitHub (`Orodrigao/PaneProducao`)

### Controle de Acesso — Fase 0 Extra (Maio 2026)
- [x] `src/lib/auth.ts` — lista de usuários com PINs, funções authenticate/getCurrentUser/logout/canAccess
- [x] `src/app/login/page.tsx` — tela de login 2 etapas: seleção de usuário → teclado PIN
- [x] `src/components/AuthGuard.tsx` — proteção de rotas, redirect para /login
- [x] `src/components/Nav.tsx` — filtragem de links por role + botão Sair
- [x] `src/app/layout.tsx` — AuthGuard envolvendo toda a aplicação
- [x] Remoção de senhas full-page de: estoque, estoque/entrada, fornecedores, produtos, page.tsx

---

## 🔲 Pendente — Fase 1 (resto)

- [ ] Tela `/estoque/inventario` — ajuste físico de saldo por inventário
  - Listar todos os insumos com saldo atual
  - Usuário informa contagem física
  - Sistema registra `stock_movements` tipo `ajuste` para cada diferença
  - Confirmação em lote

---

## 🔄 Em andamento — PR-C: Clientes PJ + Tabelas de preço

### ✅ PR-C1 (entregue) — Schema + cadastro de clientes
- Tabelas criadas: `customers`, `price_tiers`, `price_tier_items`, `customer_price_overrides`
- Extensão em `orders`: customer_id, unit_price, pack_size, pricing_unit, order_type ('producao'|'pj'|'encomenda')
- Coluna `is_special` em breads e products (produto fora dos catálogos normais)
- `/clientes/page.tsx` — CRUD: nome, doc, contato, tabela default, desconto base, delivery hours, notas
- Acesso: admin (Rodrigão, Suélen) + financeiro (Elis)

### ✅ PR-C2 (entregue) — Cadastro de tabelas de preço + overrides
- `/tabelas-preco/page.tsx` com 2 abas: Tabelas + Preços por cliente
- Aba Tabelas: lista de tabelas; drill-down pra editar nome/descrição/ativo, adicionar produtos via busca, inputs inline pra preço/un/pack, remover item, copiar tabela inteira
- Aba Preços por cliente: select cliente, mostra preço de tabela + desconto aplicado + override; cria/edita/remove override inline (override em destaque amarelo)
- Catálogo PJ: breads ativos + products com is_pj OR is_special
- Acesso: admin + financeiro (rota /tabelas-preco)

### ✅ PR-C3a (entregue) — Tela /pedidos-pj + schema de datas
- Migration: ALTER orders ADD delivery_date, production_date, product_source, product_name
- `/pedidos-pj/page.tsx` com 2 abas: Novo Pedido + Lista
- Novo Pedido: dropdown cliente → autopreenche tabela/desconto/datas; busca produtos do catálogo do cliente (tier+overrides com preço já calculado); linhas com pack editável; total monetário
- Validação: delivery não pode cair em domingo (warning); production_date = delivery - 24h (default editável)
- Lista: pedidos agrupados (customer+order_date+delivery_date); badge de status (agendado/em produção/entregue); modal de visualização com botão "Adiantar pra hoje"
- Acesso: admin + financeiro

### ✅ PR-C3b (entregue) — Integração com produção
- `/forno`: query refatorada — lojas via `store != 'pj'` + `order_date`;
  PJ via `store = 'pj'` filtrado por `production_date` (novos) OU
  `pj_delivery_date` (legados sem production_date)
- Aviso no topo: "🧾 N pedido(s) PJ produzindo neste dia → Ver detalhes"
  linkando pra /pedidos-pj
- Breakdown por bread: "Planejado: 240 · 180 lojas + 60 PJ"
- `/` (Pedidos de Produção) sem mudança — fluxo das lojas + pedido PJ
  texto-livre antigo continuam funcionando paralelo; migração total
  fica pra PR futuro
- Antecipar pedido continua só em /pedidos-pj (Geolar vai lá pelo
  link no aviso)

### ✅ PR-C4 (entregue) — Relatórios PJ
- `/relatorios/pj` — KPIs (vendas totais, pedidos, ticket médio, clientes únicos)
- Tabela por cliente (pedidos + ticket médio) + top produtos por valor
- Filtro por período + filtro por cliente + export CSV (ambas as tabelas)

### 🔲 PR-C5 (futuro) — Encomendas
- Cliente físico avulso pede pra dia específico (ex: 3 focaccias pra sexta)
- Reusa schema de customers (sem tier obrigatório)
- Pode usar Produto Especial (is_special) — sob demanda
- order_type='encomenda' em orders
- Tela própria ou aba em /

---

## 🔲 Planejado — Compras v2 (redesign das listas de compra)

Redesign acordado com Rodrigão (01/06/26). Modelo completo em `PLAN.md` → "Redesign — Módulo de Compras". Troca a lista única/mutável por setor por **listas discretas com histórico**, catálogo **curado só pelo admin**, e **desfecho por item** do lado do comprador.

**Defaults assumidos** (confirmar): unidade do adicional via **picker** (un/kg/cx/dz/maço/L); desfechos = `comprado / tem / nao_encontrei` (sem "cancelado"); Elis ganha papel **comprador**. Status no banco mantém `draft/submitted/completed` (rótulos PT só na UI).

### ✅ COMP-1 — Schema + migração de base (aplicado 01/06/26)
- [x] `ALTER purchase_lists`: drop `UNIQUE(sector)`; add `created_by`, `closed_by`, `closed_at`, `updated_at`
- [x] `ALTER purchase_items`: add `outcome` (pendente|comprado|tem|nao_encontrei), `bought_quantity`, `bought_by`, `bought_at`, `updated_at`
- [x] Backfill `checked=true` → `outcome='comprado'` (0 linhas — nada estava comprado); listas mantêm status atual (draft = "montando")
- [x] RLS: `anon_all` cobre as colunas novas automaticamente (nada a fazer)
- ⏭️ Gatilho `updated_at` (opcional) **não** aplicado — fica pra COMP-3, quando o rastreio de alteração precisar

### 🔲 COMP-2 — Fluxo do solicitante
- [ ] `/compras`: criar **nova lista** (montando) — permitir **várias por setor**
- [ ] Adicionar item do **catálogo** (busca, como hoje) + **adicional** (nome + unidade via **picker**, não caixa de texto)
- [ ] **Enviar** lista → status submitted + Telegram; **trava** edição do solicitante
- [ ] "Esqueci item" → botão de **nova lista** (não reabre a enviada)

### 🔲 COMP-3 — Painel do comprador
- [ ] Visão com **listas abertas agrupadas por setor** ("o que comprar")
- [ ] **Desfecho por item:** comprado (qtd comprada + auto quem/quando) / já tem / não encontrei
- [ ] **Transformar adicional em produto** (cria em `products` com `kind=insumo` + unidade; linka `product_id` no item)
- [ ] **Fechar lista** (completed) manualmente, mesmo com itens em aberto
- [ ] Acesso: admin (Rodrigão, Suélen) + novo papel **comprador** (Elis)

### 🔲 COMP-4 — Papel comprador + notificação
- [ ] `app_users`/auth: papel/route **comprador** (Elis); admin já cobre Rodrigão + Suélen
- [ ] Telegram adaptado pra **multi-lista** (uma notificação por lista enviada)
- [ ] Badge no app: nº de listas abertas/novas pro comprador

### 🔲 COMP-5 — Histórico + consumo médio
- [ ] Tela de **histórico** de listas/compras (por setor, período)
- [ ] Relatório de **consumo médio por produto** (usa `bought_quantity` de itens com `product_id`)
- [ ] Pré-requisito: adicionais recorrentes promovidos a produto (senão não agregam)

**Ordem sugerida:** COMP-1 → COMP-2 → COMP-3 → COMP-4 → COMP-5.

---

## 🔲 Backlog — Catálogo (sugerido pelo Rodrigão, maio 2026)

### Categoria em `products`
- [ ] Adicionar coluna `category` em `products`: enum `KIT | INSUMO | PRODUTO_FINAL`
- [ ] Migrar dados: `MIST. PÃO DE MANDIOQUINHA` e similares vão pra `INSUMO`; `Kit Pão de *` viram `KIT`; resto vira `PRODUTO_FINAL`
- [ ] Filtros visuais por categoria em `/produtos`
- [ ] Em `/estoque/entrada` e `/compras`: filtrar só categoria `INSUMO`

### Composição de KIT (BOM — Bill of Materials)
- [ ] Tabela `product_components` (kit_product_id, component_source [bread|product], component_id, quantity)
  - Ex: 1 unidade de "Kit Pão de Hamburguer" = 4 unidades do bread "Pão de Hamburguer"
- [ ] Tela `/produtos/[id]/composicao` — admin cadastra componentes de cada kit
- [ ] Trigger/lógica: quando vende/descarta 1 KIT em sobras/romaneio, descontar `quantity` unidades de cada componente em `bread_movements`
- [ ] CMV automático: custo do kit = soma do custo dos componentes
- [ ] Saldo de pão por loja precisa contar consumo de kits

(esses dois itens são pré-requisito pra Fase 5/6 — não dá pra calcular CMV correto sem composição de kit)

---

## 🔲 Próxima — Fase 2: Leitura de NF com IA

- [ ] Supabase Storage configurado para armazenar imagens de NF
- [ ] Tabela `invoices` criada
- [ ] Tela `/estoque/entrada-nf` — upload/foto da NF
- [ ] Integração com OpenRouter (Claude Vision ou GPT-4o) para extração dos dados
- [ ] Tela de revisão — usuário confirma/corrige itens extraídos pela IA
- [ ] Gravação automática em `stock_entries` + `payables` (quando Fase 3 existir)

---

## 🔲 Backlog — Fase 3: Contas a Pagar

- [ ] Tabelas: `expense_categories`, `payables`
- [ ] Seed das categorias padrão (Insumos, Embalagens, Aluguel, Folha, Empréstimos...)
- [ ] Tela `/financeiro/pagar` — lista com filtros e status
- [ ] Tela `/financeiro/pagar/novo` — lançamento manual
- [ ] Tela `/financeiro/fluxo` — projeção de caixa 30/60/90 dias

---

## 🔲 Backlog — Fase 4: Importação de Vendas do CNM

- [ ] Tabelas: `sales_imports`, `sales_items`
- [ ] Tela `/financeiro/importar-vendas` — upload de CSV/Excel do CNM
- [ ] Parser: mapeamento de colunas + match de produtos
- [ ] Revisão e confirmação da importação

---

## 🔲 Backlog — Fase 5: CMV e Dashboard

- [ ] Tela `/dashboard` — visão geral do dono
- [ ] Tela `/financeiro/cmv` — CMV por produto/categoria/período
- [ ] Tela `/financeiro/expedicao` — análise de lucratividade do canal EX
- [ ] Tela `/financeiro/dre` — DRE simplificado mensal

---

## 🔲 Backlog — Fase 6: Ficha Técnica

- [ ] Tabela `product_recipes` (composição de insumos por produto)
- [ ] Tela `/produtos/[id]/ficha-tecnica` — composição + custo calculado + margem sugerida
