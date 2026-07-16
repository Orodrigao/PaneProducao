# Mapa da documentação

## Fontes canônicas

- [CURRENT_STATE.md](CURRENT_STATE.md) — fase, capacidades e riscos atuais.
- [PLAN.md](PLAN.md) — ordem para chegar ao CMV.
- [PRD.md](PRD.md) — problema de negócio e requisitos estáveis.
- [../AGENTS.md](../AGENTS.md) — regras de trabalho e segurança.

## Documentos específicos

Leia somente quando a tarefa tocar o assunto:

- [SALES_IMPORT_CNM.md](SALES_IMPORT_CNM.md);
- documentos de segurança Supabase;
- auditoria de design;
- runbooks operacionais.

Antes de reutilizar um documento específico, compare sua data e seu status com
`CURRENT_STATE.md`.

## Registros históricos

Arquivos com `AUDIT`, `RESULT`, data no nome e a pasta `codex-tasks/` preservam
evidência de decisões e aplicações anteriores. Eles podem descrever
corretamente aquele momento sem representar o estado atual.

Não copie “próximo passo”, status ou SQL de um registro histórico sem nova
auditoria.

## Regra de manutenção

- Estado muda: atualizar `CURRENT_STATE.md`.
- Ordem ou critério muda: atualizar `PLAN.md`.
- Requisito de negócio muda: atualizar `PRD.md`.
- Regra global muda: atualizar `AGENTS.md`.
- Aprendizado generalizável: atualizar `../lessons.md`.
- Detalhe de execução: manter no PR e no commit.
