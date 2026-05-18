# PRD — ERP Pane & Salute
**Versão:** 1.0  
**Data:** Maio 2026  
**Dono do produto:** Rodrigo (Rodrigão) — fundador e CEO da Pane & Salute

---

## 1. O Negócio

**Pane & Salute** é uma padaria artesanal com 3 lojas em Caxias do Sul (RS), 12 anos de mercado e referência na cidade. O negócio tem faturamento razoável e produtos com margens de lucro altas — mas a operação não está lucrativa. O dinheiro está curto todo mês.

O principal problema identificado: **não existe visibilidade sobre para onde vai o dinheiro**. Não se sabe com precisão o CMV, o custo real de cada canal de venda, nem se o desperdício está sendo controlado. Dívidas do passado pesam no caixa, mas a dúvida é: mesmo sem essas dívidas, a operação seria lucrativa? Essa pergunta precisa ser respondida.

### Canais de venda
- **Balcão (lojas)** — margem mais alta, venda direta ao cliente final
- **Expedição (EX)** — fornecimento para um cliente externo com margem menor no produto + custos extras: veículo, motorista, funcionário da expedição, embalagens específicas. A lucratividade real deste canal é desconhecida.

### Sistema atual
- **Controle Na Mão (CNM)** — PDV, emissão de cupom fiscal e NF, integração SEFAZ. Continuará sendo usado por muito tempo para tudo que é fiscal. O ERP não vai substituí-lo nessa função.
- **Planilhas e papel** — controle financeiro precário de contas a pagar e receber.
- Praticamente nenhum controle de estoque, produção ou custo.

---

## 2. O Objetivo do ERP

Construir uma plataforma interna que responda a pergunta central do negócio:

> **"Para onde vai o dinheiro da Pane & Salute?"**

De forma específica:
- Qual é o CMV real por produto e por categoria?
- Quanto custa produzir o que foi produzido?
- Quanto foi desperdiçado e qual o custo disso?
- O canal Expedição é lucrativo depois de descontados todos os seus custos?
- Quais são as contas a pagar e como elas se comparam com a receita?

O ERP **não vai substituir o CNM**. Vai receber os dados de venda via importação de relatório e cruzar com os dados de custo que ele mesmo controla.

---

## 3. Usuários do Sistema

| Perfil | Quem | O que faz no sistema |
|--------|------|----------------------|
| **Dono** | Rodrigão | Vê todos os módulos, dashboards financeiros, aprova listas de compra |
| **Financeiro** | Suélen | Contas a pagar/receber, importação de NF, relatórios |
| **Produção** | Equipe padaria/cozinha | Registra pedidos de produção diários |
| **Expedição** | Gustavo | Controla estoque congelado, romaneio |
| **Compras** | Geolar (Padaria), Fran (Cozinha), Liara/Elis (Loja) | Preenchem e enviam listas de compra |

---

## 4. Módulos do Sistema

### 4.1 Módulos Existentes (em produção)

| Módulo | URL | Status | Descrição |
|--------|-----|--------|-----------|
| Pedidos de Produção | `/` | ✅ Produção | Equipe registra o que vai produzir no dia |
| Sobras e Descartes | `/sobras` | ✅ Produção | Registro de sobras e descartes por usuário/turno |
| Romaneio de Expedição | `/romaneio` | ✅ Produção | Controle de entrega entre lojas e para EX |
| Catálogo de Produtos | `/produtos` | ✅ Produção | Gestão de produtos com categoria, custo, ativo/inativo |
| Estoque Congelado | `/estoque-congelado` | ✅ Produção | Entrada/saída/inventário em 3 locais (Freezer H., Câmara, Freezer Loja) |
| Lista de Compras | `/compras` | ✅ Produção | Listas por setor com notificação Telegram ao enviar |

### 4.2 Módulos a Construir (por prioridade)

#### PRIORIDADE 1 — Fechar o CMV

**Estoque de Insumos**
- Controle de entrada de insumos (via leitura de NF com IA ou importação manual)
- Baixa automática de estoque conforme produção registrada
- Inventário periódico para ajuste
- Alertas de estoque mínimo
- Meta: saber o custo real do que foi consumido na produção

**Leitura de Nota Fiscal com IA**
- Usuário fotografa a NF de compra de insumos
- IA (modelo de visão) extrai: fornecedor, itens, quantidades, valores, data
- Sistema alimenta estoque de insumos + contas a pagar automaticamente
- Reduz trabalho manual e elimina erros de digitação

**Importação de Vendas do CNM**
- Importação de relatório exportado pelo CNM (CSV ou Excel)
- Sistema reconhece produtos, quantidades vendidas, valores por canal
- Necessário para fechar o CMV: custo de produção ÷ receita de venda

**CMV Dashboard**
- Custo de Mercadoria Vendida por período (dia, semana, mês)
- CMV por produto e por categoria
- CMV por canal (balcão vs expedição)
- Comparativo meta vs realizado
- % CMV sobre faturamento (meta: abaixo de X%)

#### PRIORIDADE 2 — Visibilidade Financeira

**Contas a Pagar**
- Lançamento manual e via leitura de NF
- Categorização (insumos, folha, aluguel, empréstimos, fornecedores)
- Separação clara entre dívidas do passado e custo operacional corrente
- Calendário de vencimentos
- Fluxo de caixa projetado

**Análise da Expedição**
- Custo total do canal EX: produto + veículo + motorista + funcionário + embalagem
- Receita gerada pelo canal EX
- Margem líquida da EX vs balcão
- Resposta definitiva: vale a pena continuar fornecendo para a EX?

**DRE Simplificado**
- Receita (importada do CNM)
- CMV (calculado pelo ERP)
- Margem bruta
- Despesas operacionais (do contas a pagar)
- Resultado líquido
- Separado por loja quando possível

#### PRIORIDADE 3 — Inteligência Operacional

**Dashboard do Dono**
- Visão consolidada: faturamento, CMV, margem, sobras do dia
- Alertas: produto com CMV acima do esperado, desperdício elevado, item zerado no estoque
- Comparativo entre lojas

**Custo por Produto (Ficha Técnica)**
- Composição de insumos de cada produto
- Custo calculado automaticamente baseado no preço dos insumos no estoque
- Permite saber o preço mínimo de venda e a margem real

**Relatórios Exportáveis**
- CMV mensal para apresentar à contabilidade
- Relatório de sobras e descartes
- Relatório de compras realizadas vs orçamento

---

## 5. Integrações

| Sistema | Como | Quando |
|---------|------|--------|
| CNM (PDV) | Importação de relatório (CSV/Excel) | Curto prazo |
| Nota Fiscal (fornecedores) | Foto + IA (OCR + extração de dados) | Médio prazo |
| Telegram | Notificação de lista de compras | ✅ Já feito |
| WhatsApp | Notificações operacionais | Futuro |

---

## 6. O que este ERP NÃO faz

- Emissão de cupom fiscal ou nota fiscal (CNM faz isso)
- Integração direta com SEFAZ
- Gestão de funcionários / folha de pagamento
- Delivery ou gestão de pedidos externos
- Controle de mesas ou comanda (não é restaurante)

---

## 7. Princípios do Produto

- **Simples de usar** — funcionários não são técnicos. A interface precisa ser óbvia.
- **Mobile-first** — a maioria dos usuários acessa pelo celular durante o trabalho.
- **Dados reais, não estimativas** — cada número mostrado tem origem rastreável.
- **Uma fonte de verdade** — o que o ERP diz é o que vale. Sem planilhas paralelas.
- **Evolução gradual** — cada módulo entrega valor sozinho. Não esperamos tudo estar pronto para usar.

---

## 8. Métricas de Sucesso

| Métrica | Hoje | Meta |
|---------|------|------|
| CMV calculado automaticamente | Não existe | Mensal, depois semanal |
| % desperdício sobre produção | Desconhecido | Medido e abaixo de X% |
| Lucratividade da Expedição | Desconhecida | Calculada e decidida |
| Tempo para fechar o custo mensal | Não é feito | Menos de 1 hora |
| Dívida vs custo operacional | Misturados | Separados e visíveis |

