# CODEX_FIRST_TASK_PROMPT.md — Prompt para primeira tarefa no Codex

Copie e cole no Codex aberto dentro do repositório `Orodrigao/PaneProducao`.

```text
Você está no repositório PaneProducao, ERP interno da Pane&Salute.

Objetivo desta tarefa: preparar o projeto para ser conduzido por Codex, sem alterar código funcional, schema, Supabase, Edge Functions, env vars ou deploy.

Escopo permitido:
- Criar `AGENTS.md` na raiz se ainda não existir.
- Criar `docs/CODEX_PROJECT_COMMAND.md`.
- Criar `docs/CODEX_ENVIRONMENT.md`.
- Criar `docs/CMV_EXECUTION_PLAN.md` se ainda não existir.
- Criar `docs/SALES_IMPORT_CNM.md` se ainda não existir.
- Criar `docs/DESIGN_AUDIT.md` se ainda não existir.
- Atualizar `README.md` apenas para apontar `AGENTS.md` como instrução principal do agente, mantendo `CLAUDE.md` como legado/histórico.

Escopo proibido:
- Não mexer em `src/`.
- Não mexer em `supabase/`.
- Não alterar `.env*`.
- Não criar migrations.
- Não chamar Supabase com escrita.
- Não rodar deploy.
- Não fazer push direto na `main`.

Antes de editar:
1. Rode `git status -sb`.
2. Leia `README.md`, `CLAUDE.md`, `docs/PRD.md`, `docs/PLAN.md`, `docs/TASKS.md`.
3. Resuma o entendimento em 8 linhas.
4. Mostre plano curto e só então edite.

Conteúdo central que deve constar nos docs:
- Prioridade estratégica: CMV confiável.
- Ordem: segurança → XML compras → unidades/conversões → entrada de estoque transacional → ficha técnica → vendas CNM → perdas/rupturas → CMV → dashboard → IA.
- Não criar dashboard antes de ficha técnica e vendas.
- Supabase/RLS/Auth é Sprint 0.
- Repo público + app estático + chave pública exige RLS forte.
- Codex deve trabalhar sempre em PRs pequenos.

Validação:
- Como é docs-only, rode `git diff --check`.
- Se alterar README, rode também `npm test` somente se for barato; se não rodar, explique por que não era necessário.

Entrega final:
- Liste arquivos alterados.
- Explique o que foi documentado.
- Informe que não houve alteração de código nem banco.
- Sugira o próximo PR: `docs/SUPABASE_SECURITY_AUDIT.md` com matriz tabela/RLS/policies/risco/ação.
```
