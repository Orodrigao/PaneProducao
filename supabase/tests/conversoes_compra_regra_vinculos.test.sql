begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Conversões de compra do Catálogo (public.update_payable_product_mappings)
-- seguem a regra de quem corrige memória de vínculo de NF-e
-- (private.pode_corrigir_vinculos_nfe): todo Administrador e o Financeiro com
-- Catálogo e Contas a pagar da JC. O caso que mudou é o Financeiro com o
-- Catálogo e sem o Contas a pagar, que antes gravava fator e agora é barrado.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('97200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-conversao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97200000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-autorizado-conversao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97200000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-sem-permissao-conversao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97200000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-sem-catalogo-conversao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97200000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'compras-conversao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97200000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-inativo-conversao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97200000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-ja-conversao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('97200000-0000-4000-8000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'financeiro-todas-rotas-conversao@example.com', 'x', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes) values
  ('97200000-0000-4000-8000-000000000001', 'Administrador Conversão', 'admin', null, true, '["/"]'::jsonb),
  ('97200000-0000-4000-8000-000000000002', 'Financeiro autorizado Conversão', 'financeiro', 'jc', true, '["/produtos"]'::jsonb),
  ('97200000-0000-4000-8000-000000000003', 'Financeiro sem permissão Conversão', 'financeiro', 'jc', true, '["/produtos"]'::jsonb),
  ('97200000-0000-4000-8000-000000000004', 'Financeiro sem Catálogo Conversão', 'financeiro', 'jc', true, '["/contas-pagar"]'::jsonb),
  ('97200000-0000-4000-8000-000000000005', 'Compras Conversão', 'compras', 'jc', true, '["/produtos"]'::jsonb),
  ('97200000-0000-4000-8000-000000000006', 'Financeiro inativo Conversão', 'financeiro', 'jc', false, '["/produtos"]'::jsonb),
  ('97200000-0000-4000-8000-000000000007', 'Financeiro JA Conversão', 'financeiro', 'ja', true, '["/produtos"]'::jsonb),
  ('97200000-0000-4000-8000-000000000008', 'Financeiro todas as rotas Conversão', 'financeiro', 'jc', true, '["*"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope) values
  ('97200000-0000-4000-8000-000000000002', 'contas_pagar.acessar', 'jc'),
  ('97200000-0000-4000-8000-000000000004', 'contas_pagar.acessar', 'jc'),
  ('97200000-0000-4000-8000-000000000005', 'contas_pagar.acessar', 'jc'),
  ('97200000-0000-4000-8000-000000000006', 'contas_pagar.acessar', 'jc'),
  ('97200000-0000-4000-8000-000000000007', 'contas_pagar.acessar', 'ja'),
  ('97200000-0000-4000-8000-000000000008', 'contas_pagar.acessar', '*');

insert into public.suppliers (id, name, active) values
  ('97200000-0000-4000-8000-000000000011', '[TESTE] Fornecedor da conversão', true);
insert into public.products (id, name, category, active, unit, kind) values
  ('97200000-0000-4000-8000-000000000021', '[TESTE] Insumo da conversão', 'Insumos', true, 'kg', 'insumo');
insert into public.payable_product_mappings (
  id, supplier_id, supplier_product_code, supplier_description, purchase_unit,
  base_product_id, base_unit, conversion_basis, conversion_factor, factor_confirmed, last_confirmed_by
) values
  ('97200000-0000-4000-8000-000000000031', '97200000-0000-4000-8000-000000000011', 'CONV-1', 'Caixa da conversão', 'CX',
   '97200000-0000-4000-8000-000000000021', 'kg', 'package', 1, false, '97200000-0000-4000-8000-000000000001');

select ok(has_function_privilege('authenticated', 'public.update_payable_product_mappings(uuid, jsonb)', 'execute'),
  'perfil autenticado chama a função, que decide o acesso');
select ok(not has_function_privilege('anon', 'public.update_payable_product_mappings(uuid, jsonb)', 'execute'),
  'perfil anônimo não chama a função de conversão');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""'])
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'update_payable_product_mappings'),
  'função de conversão é security definer com search_path vazio');

set local role authenticated;

-- Barrados: a recusa vem antes de qualquer gravação.
select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select public.update_payable_product_mappings('97200000-0000-4000-8000-000000000021',
    '[{"id":"97200000-0000-4000-8000-000000000031","conversion_basis":"package","conversion_factor":12}]'::jsonb)$$,
  '42501', 'Sem permissão para corrigir conversões de compra.',
  'Financeiro com o Catálogo e sem o Contas a pagar da JC é barrado');

select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select public.update_payable_product_mappings('97200000-0000-4000-8000-000000000021',
    '[{"id":"97200000-0000-4000-8000-000000000031","conversion_basis":"package","conversion_factor":12}]'::jsonb)$$,
  '42501', 'Sem permissão para corrigir conversões de compra.',
  'Financeiro sem o Catálogo é barrado');

select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.update_payable_product_mappings('97200000-0000-4000-8000-000000000021',
    '[{"id":"97200000-0000-4000-8000-000000000031","conversion_basis":"package","conversion_factor":12}]'::jsonb)$$,
  '42501', 'Sem permissão para corrigir conversões de compra.',
  'Compras com o Catálogo e o Contas a pagar é barrado');

select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$select public.update_payable_product_mappings('97200000-0000-4000-8000-000000000021',
    '[{"id":"97200000-0000-4000-8000-000000000031","conversion_basis":"package","conversion_factor":12}]'::jsonb)$$,
  '42501', 'Sem permissão para corrigir conversões de compra.',
  'Financeiro inativo é barrado');

select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000007', true);
select throws_ok(
  $$select public.update_payable_product_mappings('97200000-0000-4000-8000-000000000021',
    '[{"id":"97200000-0000-4000-8000-000000000031","conversion_basis":"package","conversion_factor":12}]'::jsonb)$$,
  '42501', 'Sem permissão para corrigir conversões de compra.',
  'Financeiro com o Contas a pagar só da JA é barrado');

reset role;
select is((select conversion_factor from public.payable_product_mappings
  where id = '97200000-0000-4000-8000-000000000031'), 1::numeric,
  'nenhuma recusa mudou o fator');
select ok((select not factor_confirmed from public.payable_product_mappings
  where id = '97200000-0000-4000-8000-000000000031'),
  'nenhuma recusa marcou o fator como conferido');
set local role authenticated;

-- Permitidos: Financeiro autorizado (rota do Catálogo ou todas, permissão da
-- JC ou de todas as lojas) e Administrador, este mesmo sem a rota /produtos,
-- como na correção de vínculos.
select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000008', true);
select lives_ok(
  $$select public.update_payable_product_mappings('97200000-0000-4000-8000-000000000021',
    '[{"id":"97200000-0000-4000-8000-000000000031","conversion_basis":"package","conversion_factor":11}]'::jsonb)$$,
  'Financeiro com todas as rotas e o Contas a pagar de todas as lojas grava a conversão');

select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$select public.update_payable_product_mappings('97200000-0000-4000-8000-000000000021',
    '[{"id":"97200000-0000-4000-8000-000000000031","conversion_basis":"package","conversion_factor":12}]'::jsonb)$$,
  'Financeiro com o Catálogo e o Contas a pagar da JC grava a conversão');

reset role;
select is((select conversion_factor from public.payable_product_mappings
  where id = '97200000-0000-4000-8000-000000000031'), 12::numeric,
  'o fator gravado pelo Financeiro autorizado ficou na memória');
set local role authenticated;

select set_config('request.jwt.claim.sub', '97200000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.update_payable_product_mappings('97200000-0000-4000-8000-000000000021',
    '[{"id":"97200000-0000-4000-8000-000000000031","conversion_basis":"package","conversion_factor":10}]'::jsonb)$$,
  'Administrador grava a conversão mesmo sem a rota do Catálogo');

reset role;
select is((select conversion_factor from public.payable_product_mappings
  where id = '97200000-0000-4000-8000-000000000031'), 10::numeric,
  'o fator gravado pelo Administrador ficou na memória');
select is((select last_confirmed_by from public.payable_product_mappings
  where id = '97200000-0000-4000-8000-000000000031'), '97200000-0000-4000-8000-000000000001'::uuid,
  'a memória registra o Administrador como quem confirmou');

select * from finish();
rollback;
