# Supabase — Resultado da aplicação de app_profiles

## Resumo

A migration de `app_profiles` foi aplicada com sucesso no projeto Supabase `PanePedidosLojas`, ref `gohluceldchoitihrimw`.

## Migration local versionada

Arquivo no repositório:

`supabase/migrations/20260614120000_create_app_profiles.sql`

## Registro no histórico remoto

O Supabase registrou a aplicação remota como:

`20260614182614_create_app_profiles`

Há diferença entre o timestamp do arquivo local e o registro remoto porque a aplicação foi feita via Supabase MCP, não pelo Supabase CLI local.

## Resultado validado

- `public.app_profiles` existe;
- RLS habilitado;
- force RLS habilitado;
- `anon` sem grants;
- `authenticated` com somente `SELECT`;
- policy criada: `app_profiles_select_own`;
- regra da policy: `(user_id = auth.uid())`;
- `with_check` nulo;
- `count(*)` de `app_profiles`: 0;
- nenhuma tabela de negócio foi alterada;
- `app_users`, login atual e PINs não foram alterados;
- git estava limpo ao final.

## Ponto de atenção

Antes de novas migrations, é preciso considerar o desalinhamento entre:

- migration local: `20260614120000_create_app_profiles.sql`;
- histórico remoto: `20260614182614_create_app_profiles`.

Não rodar `supabase db push` ou `supabase migration up` sem revisar esse ponto.

## Próximos passos recomendados

- Definir como criar perfis reais em `app_profiles`;
- Planejar fluxo futuro de vínculo com Supabase Auth;
- Não alterar o login atual ainda;
- Não aplicar RLS em tabelas de negócio sem nova tarefa específica.
