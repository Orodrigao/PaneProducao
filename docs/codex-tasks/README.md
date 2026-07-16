# Tarefas Codex — arquivo histórico

Esta pasta preserva planos e runbooks usados em fases anteriores. Os arquivos
podem explicar decisões, mas não representam automaticamente o estado atual e
não devem ser executados novamente sem auditoria.

Fonte atual:

- [../../AGENTS.md](../../AGENTS.md);
- [../CURRENT_STATE.md](../CURRENT_STATE.md);
- [../PLAN.md](../PLAN.md).

## Registros existentes

| Arquivo | Natureza |
|---|---|
| `01_SUPABASE_AUTH_PROFILES_FOUNDATION.md` | Fundação histórica de `app_profiles` |
| `02_SUPABASE_APPLY_APP_PROFILES_MIGRATION.md` | Runbook histórico de aplicação |
| `03_APP_PROFILES_REAL_USERS_PLAN.md` | Planejamento histórico de perfis |
| `04_APP_PROFILES_SAFE_CREATION_STRATEGY.md` | Estratégia histórica de criação |
| `05_FIRST_AUTH_USERS_AND_PROFILES_PLAN.md` | Plano histórico da primeira leva |
| `06_FIRST_AUTH_USERS_CREATION_RUNBOOK.md` | Runbook histórico da primeira leva |
| `08_CATALOGO_UNICO_FASE1_SCHEMA.md` | Plano histórico do catálogo único |
| `10_CATALOGO_UNICO_BACKFILL_MIGRATION.md` | Registro histórico do backfill |

Planos novos devem ser criados somente quando ajudam a revisar uma
funcionalidade complexa. Estado temporário deve ficar no PR, não nesta pasta.
