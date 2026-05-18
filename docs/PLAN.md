# PLAN — Plano Técnico ERP Pane & Salute
**Versão:** 1.0  
**Data:** Maio 2026  
**Referência:** PRD.md

---

## Stack Técnica

| Camada | Tecnologia | Decisão |
|--------|-----------|---------|
| Frontend | HTML puro (SPAs single-file) → migrar para Next.js | Atual funciona. Migrar quando a complexidade exigir. |
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

---

## Fases de Desenvolvimento

---

### FASE 1 — Estoque de Insumos e CMV Base
**Objetivo:** ter o custo real de compra dos insumos no sistema  
**Entrega:** saber quanto foi gasto em insumos por período

#### Tabelas novas
```sql
-- Fornecedores
suppliers (id, name, cnpj, phone, email, active)

-- Entradas de estoque (compras de insumos)
stock_entries (id, supplier_id, entry_date, invoice_number, total_value, notes, created_by)
stock_entry_items (id, entry_id, product_id, quantity, unit_cost, total_cost)

-- Saldo atual de estoque por produto
stock_balance (id, product_id, quantity, average_cost, last_updated)

-- Movimentações de estoque
stock_movements (id, product_id, movement_type [entrada|saida|ajuste|descarte], quantity, unit_cost, reference_id, reference_type, notes, created_at)
```

#### Telas
- `/estoque` — saldo atual de todos os insumos com custo médio
- `/estoque/entrada` — registrar entrada manual (compra de insumo)
- `/estoque/inventario` — ajuste de inventário físico
- `/fornecedores` — cadastro de fornecedores

#### Dependências
- Tabela `products` já existe com insumos cadastrados (categoria INSUMOS, 122 ativos)
- Precisa adicionar campo `current_stock` e `average_cost` ou usar `stock_balance`

---

### FASE 2 — Leitura de NF com IA
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

### FASE 3 — Contas a Pagar
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

### FASE 4 — Importação de Vendas do CNM
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

### FASE 5 — CMV e Dashboard Financeiro
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

### FASE 6 — Ficha Técnica de Produto
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

## Roadmap Visual

```
HOJE          JUN/26        JUL/26        AGO/26        SET/26
  |             |             |             |             |
  |-- FASE 1 ---|             |             |             |
  | Estoque     |             |             |             |
  | Insumos     |-- FASE 2 ---|             |             |
  |             | Leitura NF  |-- FASE 3 ---|             |
  |             |             | Contas      |-- FASE 4 ---|
  |             |             | a Pagar     | Import CNM  |
  |             |             |             |             |-- FASE 5+6
  |             |             |             |             | CMV + DRE
```

---

## Convenções do Projeto

- **Arquivos:** HTML único por módulo (single-file SPA), salvo na raiz do repo
- **Rotas:** configuradas no `vercel.json`
- **API:** Supabase REST (PostgREST) com chave `sb_publishable_Su-BxUMybE1ysGiLxqNilg_YhYgItOJ`
- **Auth:** por enquanto sem autenticação formal — login por seleção de nome/senha simples
- **Mobile-first:** todos os módulos devem funcionar bem no celular
- **Língua:** português brasileiro em todo o código visível ao usuário
- **Docs:** esta pasta `/docs` — atualizar sempre que uma fase for concluída

---

## Próximo passo imediato

**Iniciar FASE 1 — Estoque de Insumos**  
Ver arquivo: `docs/STEP-01-estoque-insumos.md` (a criar)

