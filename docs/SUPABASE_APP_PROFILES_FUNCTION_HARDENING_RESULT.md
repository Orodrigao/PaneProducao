# Supabase — hardening da funcao de app_profiles

Data: 2026-06-23

## Objetivo

Corrigir o aviso de seguranca `function_search_path_mutable` na funcao `public.set_app_profiles_updated_at`, sem alterar usuarios, profiles, login, policies de tabelas operacionais ou dados do ERP.

## Migration aplicada

Migration local:

```text
supabase/migrations/20260623182318_harden_app_profiles_updated_at_function.sql
```

Migration registrada no Supabase:

```text
20260623182318_harden_app_profiles_updated_at_function
```

## Alteracao aplicada

A funcao `public.set_app_profiles_updated_at` foi recriada com:

- `search_path = ''`;
- chamada explicita a `pg_catalog.now()`;
- remocao de execucao direta por `public`, `anon` e `authenticated`.

SQL aplicado:

```sql
create or replace function public.set_app_profiles_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke execute on function public.set_app_profiles_updated_at() from public;
revoke execute on function public.set_app_profiles_updated_at() from anon;
revoke execute on function public.set_app_profiles_updated_at() from authenticated;
```

## Validacao live

Estado validado no Supabase apos a aplicacao:

```text
security_definer: false
config: search_path=""
acl: postgres=X/postgres,service_role=X/postgres
anon_can_execute: false
authenticated_can_execute: false
trigger: set_app_profiles_updated_at ativo em public.app_profiles
```

O trigger `set_app_profiles_updated_at` continua vinculado a `public.app_profiles`.

## O que nao foi alterado

- Nenhum usuario Supabase Auth foi criado, removido ou editado.
- Nenhum profile em `public.app_profiles` foi criado, removido ou editado.
- Nenhuma policy de tabela operacional foi alterada.
- Nenhum grant de tabela operacional foi alterado.
- Nenhum dado operacional foi alterado.
- Nenhum arquivo em `src/` foi alterado.
- Nenhum segredo foi gravado no repositorio.

## Observacoes

Os advisors de seguranca ainda apontam os riscos ja documentados na auditoria live de 2026-06-23:

- tabelas publicas com RLS desligado;
- policies antigas permissivas para `anon`;
- grants amplos em tabelas operacionais;
- protecao de senha vazada desligada por exigir plano Pro.

Esses pontos continuam para os proximos PRs pequenos de hardening.
