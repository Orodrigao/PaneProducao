# Supabase — Resultado da remoção de pj de app_profiles.store

## Resumo

Registrar que a migration para remover `pj` dos valores permitidos de `app_profiles.store` foi aplicada com sucesso no projeto Supabase `PanePedidosLojas`, ref `gohluceldchoitihrimw`.

## Migration local versionada

Arquivo no repositório:

`supabase/migrations/20260614205610_remove_pj_from_app_profiles_store.sql`

## Registro no histórico remoto

O Supabase registrou a aplicação remota como:

`20260614205610_remove_pj_from_app_profiles_store`

Há diferença entre o timestamp do arquivo local e o registro remoto porque a aplicação foi feita via Supabase MCP, não pelo Supabase CLI local.

## Resultado validado

- `public.app_profiles` existe;
- total de linhas em `app_profiles`: 0;
- linhas com `store = 'pj'`: 0;
- constraint `app_profiles_store_check` agora permite somente:
  - `store is null`;
  - `store in ('jc', 'ex', 'ja')`;
- comentário da constraint aplicado;
- RLS segue habilitado;
- force RLS segue habilitado;
- policy `app_profiles_select_own` segue inalterada;
- `authenticated` segue com somente `SELECT`;
- `anon` segue sem grants;
- privilégios administrativos esperados para `postgres` e `service_role`;
- nenhuma tabela de negócio foi alterada;
- `app_users`, login, usuários e dados não foram alterados.

## Conceito corrigido

- `PJ` não é loja/unidade;
- `PJ` representa clientes pessoa jurídica / Pedidos PJ;
- lojas/unidades válidas para `store`: `jc`, `ex`, `ja`;
- `null` representa escopo global.

## Ponto de atenção

Antes de novas migrations, considerar o histórico remoto aplicado via MCP.

Não rodar `supabase db push` ou `supabase migration up` sem revisar esse ponto.

## Próximos passos recomendados

- Manter `app_profiles` vazia até aprovação da lista final de usuários;
- Não criar usuários no Supabase Auth ainda;
- Não alterar login atual;
- Resolver e-mails pendentes em etapa posterior;
- Planejar futura criação segura de profiles reais.
