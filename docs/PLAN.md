# PLAN — Plano Técnico ERP Pane & Salute
**Versão:** 1.2  
**Data:** Junho 2026  
**Referência:** PRD.md

---

## Stack Técnica

| Camada | Tecnologia | Decisão |
|--------|-----------|---------|
| Frontend | Next.js (migração concluída) | Todos os módulos estão em Next.js + TypeScript. |
| Backend / DB | Supabase (PostgreSQL + RLS) | Mantém. Projeto ID: `gohluceldchoitihrimw` |
| Deploy | Vercel | Mantém. URL: `pane-producao.vercel.app` |
| Código | GitHub (`Orodrigao/PaneProducao`) | Mantém. |
| IA (futuro) | OpenRouter (Claude Vision / GPT-4o) | Para leitura de NF. Avaliar quando chegar. |
| Notificações | Telegram Bot | ✅ Já funcionando. |

---

## Estado Atual do Banco de Dados

### Tabelas existentes
- `products` — catálogo de produtos (416 itens: confeitaria, pães, insumos)
- `orders` / `order_items` — pedidos de produção
- `sobras` / `descartes` — controle de sobras e descartes
- `frozen_products` / `frozen_stock` / `frozen_movements` — estoque congelado
- `purchase_lists` / `purchase_items` — listas de compra por setor
- `breads` — catálogo de pães (usado no estoque congelado)
- `suppliers` — fornecedores ✅ FASE 1
- `stock_entries` / `stock_entry_items` — entradas de compra de insumos ✅ FASE 1
- `stock_balance` — saldo atual de insumos com custo médio ✅ FASE 1
- `stock_movements` — movimentações de estoque ✅ FASE 1

---

## Fases de Desenvolvimento

---

### FASE 1 — Estoque de Insumos e CMV Base ✅ CONCLUÍDA
**Objetivo:** ter o custo real de compra dos insumos no sistema  
**Entrega:** saber quanto foi gasto em insumos por período

#### Tabelas criadas
```sql
suppliers (id, name, cnpj, phone, email, active)
stock_entries (id, supplier_id, entry_date, invoice_number, total_value, notes, created_by)
stock_entry_items (id, entry_id, product_id, quantity, unit_cost, total_cost)
stock_balance (id, product_id, quantity, average_cost, last_updated)
stock_movements (id, product_id, movement_type [entrada|saida|ajuste|descarte], quantity, unit_cost, reference_id, reference_type, notes, created_at)
```

#### Telas entregues
- ✅ `/estoque` — saldo atual de todos os insumos com custo médio
- ✅ `/estoque/entrada` — registrar entrada manual (compra de insumo)
- ✅ `/fornecedores` — cadastro de fornecedores
- 🔲 `/estoque/inventario` — ajuste de inventário físico *(pendente)*

---

### FASE 2 — Leitura de NF com IA 🔲 NÃO INICIADA
**Objetivo:** fotografar nota fiscal → sistema alimenta estoque + contas a pagar  
**Entrega:** entrada de insumos sem digitação manual

#### Fluxo
1. Usuário abre `/estoque/entrada-nf`
2. Fotografa a NF ou faz upload da imagem
3. Sistema envia para API de visão (OpenRouter → Claude Vision ou GPT-4o)
4. IA retorna: fornecedor, CNPJ, data, lista de itens com qtd e valor
5. Sistema sugere o match de cada item com produto no cadastro
6. Usuário confirma ou corrige
7. Sistema grava entrada de estoque + lançamento no contas a pagar

#### Tabelas novas
```sql
-- Documentos fiscais importados
invoices (id, supplier_id, invoice_number, issue_date, total_value, status [pendente|processado|pago], image_url, raw_ai_response, created_at)
```

#### Dependências
- FASE 1 concluída (stock_entries)
- Conta OpenRouter ou similar configurada
- Supabase Storage para armazenar imagem da NF

---

### FASE 3 — Contas a Pagar 🔲 NÃO INICIADA
**Objetivo:** visibilidade de tudo que sai do caixa, separando dívidas de custo operacional  
**Entrega:** fluxo de caixa projetado e distinção operacional vs financeiro

#### Tabelas novas
```sql
-- Categorias de despesa
expense_categories (id, name, type [operacional|financeiro|investimento], color)

-- Contas a pagar
payables (id, description, supplier_id, category_id, amount, due_date, paid_date, paid_amount, status [aberto|pago|vencido], invoice_id, recurrent, notes)
```

#### Telas
- `/financeiro/pagar` — lista de contas a pagar com filtros
- `/financeiro/pagar/novo` — lançar conta manualmente
- `/financeiro/fluxo` — fluxo de caixa projetado (próximos 30/60/90 dias)

#### Categorias pré-configuradas
- Operacional: Insumos, Embalagens, Mão de obra, Aluguel, Energia, Manutenção, Outros
- Financeiro: Empréstimos, Parcelamentos, Juros
- Expedição: Veículo, Combustível, Funcionário EX

---

### FASE 4 — Importação de Vendas do CNM 🔲 NÃO INICIADA
**Objetivo:** trazer receita de venda para dentro do ERP sem digitar nada  
**Entrega:** receita disponível para cruzar com custo → CMV calculado

#### Fluxo
1. Usuário exporta relatório do CNM em Excel/CSV
2. Faz upload em `/financeiro/importar-vendas`
3. Sistema mapeia colunas e reconhece produtos
4. Importa: produto, quantidade vendida, valor, data, canal (balcão / EX)

#### Tabelas novas
```sql
-- Importações de venda
sales_imports (id, import_date, period_start, period_end, source [cnm], file_name, status, created_by)

-- Itens de venda importados
sales_items (id, import_id, product_id, product_name_raw, quantity, unit_price, total_price, channel [balcao|expedicao], sale_date)
```

---

### FASE 5 — CMV e Dashboard Financeiro 🔲 NÃO INICIADA
**Objetivo:** responder "para onde vai o dinheiro?"  
**Entrega:** CMV por produto/canal, DRE simplificado, análise da Expedição

#### Cálculos principais
- **CMV** = Σ (quantidade vendida × custo médio do insumo)
- **Margem Bruta** = Receita − CMV
- **Custo da Expedição** = produto + embalagem + rateio do custo do veículo/motorista
- **Margem Líquida por Canal** = Receita canal − CMV canal − Custo específico canal

#### Telas
- `/dashboard` — visão geral: faturamento, CMV%, margem, sobras
- `/financeiro/cmv` — CMV por produto, por categoria, por período
- `/financeiro/expedicao` — análise completa do canal EX
- `/financeiro/dre` — DRE simplificado mensal

---

### FASE 6 — Ficha Técnica de Produto 🔲 NÃO INICIADA
**Objetivo:** saber o custo de cada produto com base nos insumos  
**Entrega:** preço mínimo de venda e margem real calculados automaticamente

#### Tabelas novas
```sql
-- Composição de cada produto (receita)
product_recipes (id, product_id, ingredient_id, quantity, unit, notes)
```

#### Telas
- `/produtos/[id]/ficha-tecnica` — composição + custo calculado + margem sugerida

---

## Redesign — Módulo de Compras (Listas) 🔲 PLANEJADO (Jun 2026)

**Problema:** o módulo atual trata **uma lista mutável por setor** (`UNIQUE(sector)`) com status único (`draft→submitted→completed`) e "novo ciclo" que apaga tudo. Não representa o fluxo real: o solicitante pede, o comprador compra no ritmo dele (às vezes por dias), e muitas vezes o que foi pedido nem precisa ser comprado (o funcionário faz a lista de cabeça). Também não guarda histórico — impossível calcular consumo médio.

**Decisão (acordada com Rodrigão, 01/06/26):** trocar para **listas discretas que viram histórico**, com catálogo **curado só pelo admin**.

### Modelo

- **Lista** = um pedido discreto. **Vários por setor** ao longo do tempo. Ciclo (rótulos só na UI): `montando → enviada → concluída`.
  - Solicitante **trava** ao enviar (não edita mais). Correção = avisa o comprador por fora. Esqueceu item = **nova lista**.
  - Só admin/comprador edita lista já enviada.
- **Item** entra de 2 formas:
  - **catálogo** — busca e escolhe produto (unidade canônica, soma no histórico)
  - **adicional** — texto livre + unidade por **picker** (un/kg/cx/dz/maço/L). Marcado pra curadoria.
- **Desfecho do comprador** por item: `comprado` (+ qtd comprada, quem, quando) / `tem` (já tinha) / `nao_encontrei`. O comprador **fecha a lista na mão** (concluída) mesmo com itens em aberto.
- **Curadoria:** só o admin **transforma adicional em produto** do catálogo. Solicitante nunca cria produto (evita variações duplicadas do mesmo insumo).

> **Insight central:** *pedir ≠ precisar.* O consumo real = **qtd comprada**, não a pedida. Relatórios de consumo usam o desfecho `comprado`, e só de itens ligados a `product_id`.

### Mudanças de schema

```sql
-- purchase_lists
ALTER TABLE purchase_lists DROP CONSTRAINT purchase_lists_sector_key;   -- várias listas por setor
ALTER TABLE purchase_lists ADD COLUMN created_by text;
ALTER TABLE purchase_lists ADD COLUMN closed_by  text;
ALTER TABLE purchase_lists ADD COLUMN closed_at  timestamptz;
ALTER TABLE purchase_lists ADD COLUMN updated_at timestamptz DEFAULT now();
-- status mantém draft|submitted|completed (rótulos PT só na UI: montando/enviada/concluída)

-- purchase_items
ALTER TABLE purchase_items ADD COLUMN outcome text DEFAULT 'pendente'
  CHECK (outcome IN ('pendente','comprado','tem','nao_encontrei'));
ALTER TABLE purchase_items ADD COLUMN bought_quantity numeric;
ALTER TABLE purchase_items ADD COLUMN bought_by  text;
ALTER TABLE purchase_items ADD COLUMN bought_at  timestamptz;
ALTER TABLE purchase_items ADD COLUMN updated_at timestamptz DEFAULT now();
-- 'quantity' = qtd PEDIDA; 'checked' migra p/ outcome='comprado' e fica obsoleto
-- 'ad_hoc_name'/'is_adhoc' = o "item adicional"; promover preenche product_id
```

- **Papel "comprador":** hoje só admin acessa a visão de compra. Elis precisa comprar sem ser admin → novo papel/route `comprador` em `app_users` (Rodrigão e Suélen já entram via admin).
- **RLS:** manter `anon_all` (app usa chave publishable). Revisar se virar multiusuário sério.

### Telas
- *Solicitante* `/compras` — nova lista; adicionar (busca catálogo + adicional c/ picker); enviar. Lista trava após envio.
- *Comprador* — painel com listas abertas **agrupadas por setor**; desfecho por item; botão "transformar adicional em produto"; "fechar lista".
- *Histórico* — compras passadas + relatório de consumo médio por produto.

### Conserta de quebra
- `6 6KL` (qtd digitada no campo de unidade) → **picker** de unidade.
- "não consigo marcar comprado" / status volta pra draft → **some** o status único travando; vira desfecho por item + fecho manual.

---

## Roadmap Visual

```
MAI/26 ✅     JUN/26        JUL/26        AGO/26        SET/26
  |             |             |             |             |
  |-- FASE 1 ✅|             |             |             |
  | Estoque     |             |             |             |
  | Insumos     |-- FASE 2 ---|             |             |
  | (falta inv) | Leitura NF  |-- FASE 3 ---|             |
  |             |             | Contas      |-- FASE 4 ---|
  |             |             | a Pagar     | Import CNM  |
  |             |             |             |             |-- FASE 5+6
  |             |             |             |             | CMV + DRE
```

---

## Convenções do Projeto

- **Arquivos:** Next.js com TypeScript — um `page.tsx` por rota em `src/app/`
- **Rotas:** Next.js App Router (configuradas em `src/app/`). `vercel.json` mantido para compatibilidade.
- **API:** Supabase REST (PostgREST) com chave `sb_publishable_Su-BxUMybE1ysGiLxqNilg_YhYgItOJ`
- **Auth:** por enquanto sem autenticação formal — login por seleção de nome/senha simples
- **Mobile-first:** todos os módulos devem funcionar bem no celular
- **Língua:** português brasileiro em todo o código visível ao usuário
- **Docs:** esta pasta `/docs` — atualizar sempre que uma fase for concluída

---

## Próximo passo imediato

**Concluir pendência da FASE 1:** criar tela `/estoque/inventario` para ajuste físico de saldo.  
**Iniciar FASE 2:** leitura de NF com IA — ver `TASKS.md` para detalhamento.

