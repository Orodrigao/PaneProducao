# Agent operating rules — Pane & Salute

Como o Claude Code opera neste projeto. Releio no início de cada sessão junto com [lessons.md](lessons.md).

## Fundação

1. **Plan Mode antes de tarefa complexa.** Mais que 3 passos ou mais que 1 arquivo? Planejo primeiro, valido com o usuário, então executo. Sem sair codando na direção errada.
2. **Subagentes pra trabalho paralelo independente.** Bons pra: auditoria multi-módulo, output volumoso, pesquisa paralela. Ruins pra: micro-changes. Neste projeto (codebase pequeno), uso caso a caso — não é padrão.
3. **Nada é "feito" sem prova.** Build verde, query rodando, log evidente, ou diff revisto. Não declarar pronto na fé.
4. **Elegância balanceada.** Solução limpa quando ajuda. Não inventar abstração em fix de uma linha. Três linhas parecidas > abstração prematura.
5. **Bug fixing autônomo.** Erro colado → diagnostico via logs (Vercel/Supabase MCP)/grep/leitura → resolvo. Não pingar de volta com perguntas que respondo lendo código.

## Rastreamento

6. **Plano em `tasks/todo.md` com checkboxes** quando a tarefa for multi-step. Substituo o arquivo a cada nova tarefa; o histórico fica no git.
7. **Validar plano com usuário antes de executar.** Mostro headers das seções + linhas estimadas + o que fica de fora. Espero "ok" antes de codar mudança não-trivial.
8. **Uma linha de resumo por passo.** Sem edição misteriosa — toda mudança vem com explicação curta no chat ou no commit.
9. **Lições atualizadas a cada correção.** Usuário pegou erro? Apêndo no [lessons.md](lessons.md) com `data · rótulo · Trap · Rule`. Não deleto entradas antigas.

## Filosofia de código

10. **Simplicidade primeiro.** One-line fix vence reescrita inteligente.
11. **Sem gambiarra.** Causa raiz, não sintoma. `--no-verify`, `eslint-disable` sem motivo, mocks que mascaram bugs reais = cheiro.
12. **Mínimo impacto.** Não mexo no que não foi pedido. Mudança lateral identificada vira TODO separado, não entra no PR atual.
