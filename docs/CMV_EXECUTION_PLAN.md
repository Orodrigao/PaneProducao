# CMV_EXECUTION_PLAN.md — Plano de execução CMV

## Meta de 90 dias

Chegar ao CMV teórico confiável dos principais produtos e ao CMV real aproximado por família crítica de insumo.

## Sequência obrigatória

### Sprint 0 — Segurança

- Auditar RLS/policies.
- Proteger tabelas com dados sensíveis.
- Definir transição de auth custom para modelo mais seguro.
- Proteger Edge Functions com custo de IA.
- Impedir que dados financeiros sensíveis entrem antes da proteção mínima.

### Sprint 1 — Compra e custo de insumos

- Importar XML de fornecedores.
- Criar aliases de item bruto da nota para produto/insumo interno.
- Registrar histórico de preço por fornecedor.
- Calcular custo médio ponderado.

### Sprint 2 — Unidade e conversão

- Criar unidade base por insumo.
- Criar unidade de compra.
- Criar fator de conversão.
- Validar incompatibilidades.

### Sprint 3 — Estoque transacional

- Substituir entrada de estoque feita em múltiplas queries no frontend por RPC/Edge Function transacional.
- Garantir que entrada, itens, saldo e movimento sejam gravados juntos ou revertidos juntos.

### Sprint 4 — Ficha técnica versionada

- Criar versão de receita.
- Vincular produto final a ingredientes.
- Incluir rendimento, perda técnica e embalagem.
- Criar snapshot de custo.

### Sprint 5 — Vendas CNM

- Criar importação CSV/Excel do Controle Na Mão.
- Criar mapeamento nome CNM -> produto interno.
- Bloquear duplicidade por loja/data.
- Registrar canal, loja, quantidade e valor.

### Sprint 6 — Perdas, sobras e rupturas

- Adicionar loja, motivo e custo estimado às sobras/descartes.
- Criar registro de ruptura.
- Separar sobra de loja, erro de produção, validade, qualidade e descarte.

### Sprint 7 — CMV v1

- CMV teórico por produto.
- CMV por categoria.
- Margem bruta estimada.
- Perda em R$.
- Alertas de ingredientes que subiram.

## Fora de escopo até CMV v1

- Chatbot de cliente.
- Visão computacional.
- Emissão fiscal própria.
- DRE completo.
- Precificação automática.
- Compra automática sem aprovação.
