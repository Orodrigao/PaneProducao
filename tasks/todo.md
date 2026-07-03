# Tarefa: fechamento de caixa

Pedido aprovado pelo Rodrigo em 03/07/2026: criar feature para Samuel, Lia,
Suelen e Cleo registrarem no fim do dia as informacoes do fechamento de caixa.

## Entendimento

- `Vendas` e valor em R$.
- `Caixa anterior` e a abertura do caixa.
- `Envelope` e o dinheiro que fica no malote para deposito.
- `Proximo dia` e o dinheiro deixado para abrir o caixa seguinte.

## Plano

- [x] Ler docs obrigatorios e auditar auth/nav/RLS.
- [x] Criar branch `codex/fechamento-caixa`.
- [x] Criar migration local com tabela `cash_closings` e RLS desde o inicio.
- [x] Criar helper testavel para calculos de fechamento.
- [x] Criar tela `/fechamento-caixa` mobile-first usando `ps-*`.
- [x] Adicionar rota na navegacao e defaults de acesso.
- [x] Validar lint, typecheck, testes e build.

## Fora desta entrega

- Nao aplicar migration no Supabase de producao sem confirmacao separada.
- Nao alterar `app_users`, PINs ou profiles reais diretamente.
- Nao criar dashboard financeiro/CMV.
