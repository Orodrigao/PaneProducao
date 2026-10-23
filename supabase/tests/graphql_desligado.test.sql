begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- A Data API nao publica graphql_public desde a PR #445 (config.toml, testado
-- em scripts/supabase-api-config.test.mjs). Este teste prende a segunda tranca:
-- a extensao pg_graphql desligada no banco.
select ok(not exists (select 1 from pg_extension where extname = 'pg_graphql'),
  'a extensao pg_graphql esta desligada');
select ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'graphql' and p.proname = 'resolve'
), 'o resolvedor graphql.resolve deixou de existir');

-- Prova pelo caminho que o GraphQL usava: cada papel pergunta por uma tabela
-- em que tem SELECT. Com a extensao ligada, a resposta traz o tipo da tabela
-- (pizza_categoriasConnection para o visitante, app_profilesConnection para o
-- usuario logado), com ou sem introspeccao. Desligada, a funcao trocada pelo
-- gatilho do Supabase responde so o aviso; qualquer outro erro derruba o teste.
create temp table resposta_graphql (papel text not null, resposta text not null) on commit drop;
grant insert, select on resposta_graphql to anon, authenticated;

set local role anon;
insert into resposta_graphql
select 'anon', coalesce(graphql_public.graphql(
  query => '{ pizza_categoriasCollection(first: 1) { __typename } }')::text, '');
reset role;

set local role authenticated;
insert into resposta_graphql
select 'authenticated', coalesce(graphql_public.graphql(
  query => '{ app_profilesCollection(first: 1) { __typename } }')::text, '');
reset role;

select ok(has_table_privilege('anon', 'public.pizza_categorias', 'select'),
  'anon segue com SELECT em pizza_categorias, o grant do legado (a prova abaixo tem dente)');
select ok((select resposta from resposta_graphql where papel = 'anon') not ilike '%pizza_categoriasConnection%'
  and (select resposta from resposta_graphql where papel = 'anon') ilike '%pg_graphql extension is not enabled%',
  'visitante anonimo nao alcanca tabela pelo GraphQL, so recebe o aviso de desligado');
select ok(has_table_privilege('authenticated', 'public.app_profiles', 'select'),
  'authenticated segue com SELECT em app_profiles (a prova abaixo tem dente)');
select ok((select resposta from resposta_graphql where papel = 'authenticated') not ilike '%app_profilesConnection%'
  and (select resposta from resposta_graphql where papel = 'authenticated') ilike '%pg_graphql extension is not enabled%',
  'usuario logado nao alcanca tabela pelo GraphQL, so recebe o aviso de desligado');

-- Mesmo criterio dos avisos 0026 e 0027 do Security Advisor: tabela, view,
-- view materializada ou tabela externa com alguma coluna legivel pelo papel,
-- fora dos schemas do Supabase, so conta quando a extensao existe.
select is((
  select count(*)::int
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'v', 'm', 'f')
    and n.nspname = 'public'
    and exists (select 1 from pg_extension where extname = 'pg_graphql')
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        and (has_column_privilege('anon', c.oid, a.attnum, 'select')
          or has_column_privilege('authenticated', c.oid, a.attnum, 'select'))
    )
), 0, 'nenhuma tabela do schema public aparece nos avisos 0026 e 0027');

select * from finish();
rollback;
