-- Recusa de negócio nunca usa 40001 (serialization_failure).
--
-- O PostgREST 14 repete sozinho, sem limite, a transação que termina em 40001.
-- Quando a recusa vem do estado gravado ("a tela está velha"), toda repetição
-- falha igual e a chamada fica presa para sempre, segurando conexão e travas.
-- Este teste roda direto no banco e não vê o PostgREST; por isso confere o
-- código-fonte das funções. Recusa por conflito usa PT409 (HTTP 409, sem
-- repetição). Origem: PR 467 e migration 20260930094600.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select is(
  (select pg_catalog.string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname)
   from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and not exists (
       select 1 from pg_catalog.pg_depend d
       where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
     )
     and p.prosrc ~* '(errcode\s*=\s*''40001''|sqlstate\s*''40001''|serialization_failure)'),
  null,
  'nenhuma função recusa com 40001: o PostgREST repetiria a chamada sem fim'
);

select is(
  (select pg_catalog.sum((select pg_catalog.count(*) from pg_catalog.regexp_matches(p.prosrc, 'errcode\s*=\s*''PT409''', 'g')))::integer
   from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where (n.nspname, p.proname) in (
     ('private', 'save_pj_order_dispatch_quantities_lock_order_impl'),
     ('public', 'replace_pj_order_atomic_v2_impl'),
     ('public', 'corrigir_quantidade_enviada_pj'),
     ('public', 'transition_pj_flow_pilot'),
     ('public', 'change_pj_flow_terms'),
     ('public', 'resolve_pj_flow_excess'))),
  7,
  'as sete recusas por tela desatualizada de Pedidos PJ e cobrança usam PT409'
);

-- A recusa chega como PT409 de verdade, não só no texto da função: executa
-- uma delas com versão antiga.
insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values ('98400000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'conflito-pt409@example.com', '', now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);
insert into public.app_profiles(user_id, display_name, role, store, active)
values ('98400000-0000-4000-8000-000000000001', '[TESTE] Admin PT409', 'admin', null, true);
insert into public.customers(id, name, doc, payment_term_days, active)
values ('98400000-0000-4000-8000-0000000000c1', '[TESTE] Cliente PT409', '33444555000181', 7, true);
insert into public.breads(id, name, days, active, unit, is_special, is_shelf)
values ('teste-pt409', '[TESTE] Pao PT409', '{0,1,2,3,4,5,6}', true, 'un', false, false);
insert into public.orders(id, order_group_id, order_type, store, bread_id, customer_id, quantity, delivery_date)
select '98400000-0000-4000-8000-0000000000a1', '98400000-0000-4000-8000-0000000000b1', 'pj', 'jc',
  'teste-pt409', '98400000-0000-4000-8000-0000000000c1', 5, private.data_na_padaria() + 3;

select set_config('request.jwt.claim.sub', '98400000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $q$select public.replace_pj_order_atomic_v2(
    gen_random_uuid(), '98400000-0000-4000-8000-0000000000b1', '[]'::jsonb,
    '[{"id":"98400000-0000-4000-8000-0000000000a1","updated_at":"2020-01-01T00:00:00Z"}]'::jsonb)$q$,
  'PT409',
  'Pedido mudou; recarregue antes de salvar novamente.',
  'edição com a tela velha é recusada com PT409 e a mensagem de recarregar'
);
reset role;

select * from finish();
rollback;
