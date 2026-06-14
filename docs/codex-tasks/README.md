# Tarefas Codex — PaneProducao

Esta pasta contém tarefas versionadas para o Codex CLI executar dentro do repositório PaneProducao.

## Como usar

Sempre rode o Codex a partir da raiz do repositório:

```bash
cd ~/code/PaneERP
codex
```

Dentro do Codex, peça:

```text
Execute docs/codex-tasks/01_SUPABASE_AUTH_PROFILES_FOUNDATION.md
```

Ou, para a próxima tarefa versionada:

```text
Execute docs/codex-tasks/04_APP_PROFILES_SAFE_CREATION_STRATEGY.md
```

## Regras gerais

- O Codex deve sempre respeitar `AGENTS.md`.
- Tarefas com Supabase devem ser conservadoras.
- Nenhum SQL de escrita deve ser executado sem aprovação explícita.
- Nenhuma migration deve ser aplicada sem revisão.
- Nenhum segredo deve ser lido, exibido ou versionado.
- O Codex não deve commitar sem autorização.
- Ao final de cada tarefa, deve mostrar arquivos alterados, `git status -sb`, `git diff --stat` e validações executadas.

## Tarefas disponíveis

| Arquivo | Objetivo |
|---|---|
| `01_SUPABASE_AUTH_PROFILES_FOUNDATION.md` | Criar a fundação de `app_profiles` em paralelo ao `app_users`, sem alterar o login atual. |
| `02_SUPABASE_APPLY_APP_PROFILES_MIGRATION.md` | Revisar e aplicar, com aprovação explícita, a migration de `app_profiles` no Supabase. |
| `03_APP_PROFILES_REAL_USERS_PLAN.md` | Planejar perfis reais em `app_profiles`, sem alterar login, código, migrations ou dados no Supabase. |
| `04_APP_PROFILES_SAFE_CREATION_STRATEGY.md` | Planejar a estratégia segura para criação futura de profiles reais, sem criar usuários, inserir dados ou alterar login. |
