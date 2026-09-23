-- Fecha o endpoint GraphQL para anon e authenticated: o ERP não usa GraphQL
-- em lugar nenhum do site (só REST via PostgREST). Achado do advisor de
-- segurança do Supabase em 23/09/2026: 75 tabelas do ERP alcançáveis por
-- qualquer usuário logado e 5 tabelas legadas (pizza_*, site_bread_catalog)
-- por qualquer anônimo, pela introspecção do GraphQL. A RLS por trás sempre
-- valeu (GraphQL usa o mesmo papel de banco do REST, não contorna policy),
-- então isto não corrige vazamento de dado: fecha uma porta destrancada sem
-- uso, reduzindo a superfície que o advisor aponta.
--
-- A revisão adversarial (Sol/Codex) achou o que a primeira versão desta
-- migration deixava passar: a função nasce com EXECUTE concedido a PUBLIC
-- por padrão do Postgres, e revogar só de anon/authenticated não tira esse
-- caminho, porque todo papel herda PUBLIC. O REVOKE de PUBLIC abaixo fecha
-- essa herança; postgres, service_role e supabase_admin continuam com
-- acesso pelo grant próprio de cada um (confirmado em produção antes desta
-- migration, não presumido), não pelo PUBLIC.
--
-- A mesma checagem revelou uma segunda porta: o wrapper público chama
-- graphql.resolve() em SECURITY INVOKER (roda com o papel de quem chamou),
-- e anon/authenticated tinham USAGE no schema graphql e EXECUTE nas seis
-- funções internas (resolve, _internal_resolve, comment_directive,
-- exception, get_schema_version, increment_schema_version), a maioria via
-- PUBLIC de novo. Isso não é alcançável pela API HTTP do Supabase hoje (só
-- graphql_public.graphql é roteado pelo gateway), mas é alcançável por
-- qualquer conexão SQL direta com o papel anon/authenticated, então fecha
-- também. Revogar USAGE do schema já basta: sem enxergar o schema, nenhuma
-- das seis funções é alcançável, mesmo mantendo o EXECUTE de cada uma
-- (deixado como está, redundante mas inofensivo).
--
-- Reversível com o GRANT equivalente, caso algo dependa disso no futuro.

REVOKE EXECUTE ON FUNCTION "graphql_public"."graphql"(text, text, jsonb, jsonb)
  FROM PUBLIC, "anon", "authenticated";

REVOKE USAGE ON SCHEMA "graphql_public" FROM "anon", "authenticated";

REVOKE USAGE ON SCHEMA "graphql" FROM "anon", "authenticated";
