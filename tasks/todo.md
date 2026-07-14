# Tarefa: corrigir seleção da tabela BUCK no relatório EX

Pedido aprovado pelo Rodrigo em 14/07/2026: o relatório de romaneios EX
deve usar a tabela ativa `BUCK`, sem procurar pelo nome histórico
`Buck - Exposição`.

## Plano

- [x] Auditar a regra publicada e confirmar a tabela ativa no banco.
- [x] Extrair uma regra testável que identifique somente a tabela `BUCK`.
- [x] Aplicar a regra ao relatório EX e ajustar a mensagem de erro.
- [x] Rodar testes, typecheck, lint e build.

## Fora desta entrega

- Não alterar preços, tabelas ou romaneios no Supabase.
- Não ajustar as pendências históricas de unidade da cobrança.
- Não alterar autenticação, perfis ou login.
