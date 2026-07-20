# Mapa da documentação

## Fontes canônicas

- [CURRENT_STATE.md](CURRENT_STATE.md) — fase, capacidades e riscos atuais.
- [PLAN.md](PLAN.md) — ordem para chegar ao CMV.
- [PRD.md](PRD.md) — problema de negócio e requisitos estáveis.
- [../AGENTS.md](../AGENTS.md) — regras de trabalho e segurança.
- [../lessons.md](../lessons.md) — lições aprendidas; leitura obrigatória no
  início de toda tarefa.

## Documentos específicos

Leia somente quando a tarefa tocar o assunto:

- [SALES_IMPORT_CNM.md](SALES_IMPORT_CNM.md);
- [CMV_EXECUTION_PLAN.md](CMV_EXECUTION_PLAN.md);
- [SUPABASE_RLS_REMEDIATION_PLAN.md](SUPABASE_RLS_REMEDIATION_PLAN.md);
- [CODEX_ENVIRONMENT.md](CODEX_ENVIRONMENT.md) e
  [CODEX_PROJECT_COMMAND.md](CODEX_PROJECT_COMMAND.md).

Antes de reutilizar um documento específico, compare sua data e seu status com
`CURRENT_STATE.md`.

## Registros históricos

Vivem em [history/](history/) — auditorias, resultados de aplicação, matrizes
e planos de tarefas encerradas. Descrevem o passado e nunca definem o estado
atual. Ver [history/README.md](history/README.md).

Não copie “próximo passo”, status ou SQL de um registro histórico sem nova
auditoria.

## Regra de manutenção

- Estado muda: atualizar `CURRENT_STATE.md`.
- Ordem ou critério muda: atualizar `PLAN.md`.
- Requisito de negócio muda: atualizar `PRD.md`.
- Regra global muda: atualizar `AGENTS.md`.
- Aprendizado generalizável: atualizar `../lessons.md`.
- Documento perdeu vigência: mover para `history/`.
- Detalhe de execução: manter no PR e no commit.
