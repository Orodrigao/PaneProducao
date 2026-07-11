# Tarefa: sobras pendentes e reaproveitamento JC/JA

Pedido aprovado pelo Rodrigo em 11/07/2026: controlar o destino físico das
sobras de pães de JC e JA e usar apenas o reaproveitamento confirmado para
reduzir a produção nova mostrada no Forno.

## Entendimento

- EX não participa deste fluxo.
- Registrar sobra cria uma pendência ligada à loja, pão, lote e local físico.
- A intenção de reaproveitar não movimenta estoque.
- Geolar confirma quanto realmente está apto; a confirmação pode ser menor que
  o proposto e aloca primeiro os lotes mais antigos.
- Volta à vitrine não baixa estoque; congelar transfere para o estoque
  congelado; consumo interno, doação e descarte baixam o estoque da loja.
- Destinos podem ser parciais e o saldo restante continua pendente.
- Não se registra sobra nova enquanto a mesma loja tiver pendência de dia
  anterior.

## Plano aprovado

- [x] Ler documentos, skills e auditar Sobras, Produção, Forno e estoques.
- [x] Criar migração revisável com lote, pendência, eventos, planos e alocações.
- [x] Criar funções transacionais para registrar, propor, confirmar e destinar.
- [x] Adaptar `/sobras` para registrar pães de JC/JA como pendências.
- [x] Criar `/sobras/pendencias` mobile-first para Geolar e lojas.
- [x] Mostrar sobra disponível/proposta nos cards de planejamento JC/JA.
- [x] Subtrair apenas reaproveitamento confirmado no previsto do Forno.
- [x] Adicionar testes e atualizar tipos/documentação.
- [x] Rodar testes, typecheck, lint, build e revisar o diff.
- [x] Apresentar a migração antes de qualquer aplicação no Supabase.
- [x] Após aprovação, aplicar e verificar a migração no Supabase.
- [ ] Mesclar na `main` e acompanhar a publicação na Vercel.

## Fora desta entrega

- Importação ou automação do CNM.
- Baixa de vendas.
- Fluxo de sobras da EX.
- Redesign dos relatórios financeiros.
- Backfill dos 767 registros antigos de sobras como pendências.
