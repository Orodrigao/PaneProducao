-- Desconto do item e trava do fator na importação de NF-e.
--
-- O que este teste protege:
--   * o desconto do item chega ao banco e o valor gravado é o LÍQUIDO
--     (era gerado por quantidade x preço bruto, e o desconto sumia);
--   * fator 1 não passa mais sozinho quando a unidade da NF-e é de outra
--     família que a da receita — foi assim que farinha em saco de 25 kg
--     ficou gravada a R$ 74,00 o quilo;
--   * a trava é do BANCO, não da tela: o site fala direto com o Supabase;
--   * o site que está no ar (sem os campos novos) continua importando,
--     porque site e banco atualizam independentes no mesmo merge;
--   * valor de item que não bate com quantidade, preço e desconto é recusado;
--   * quem não tem a permissão de importar continua barrado.

begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- Cenário ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('95000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-fator-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('95000000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vendas-fator-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('95000000-0000-4000-8000-00000000000a', 'Financeiro Fator', 'financeiro', 'jc', true, '[]'::jsonb),
  ('95000000-0000-4000-8000-00000000000b', 'Vendas Fator', 'vendas', 'ja', true, '[]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope)
values ('95000000-0000-4000-8000-00000000000a', 'contas_pagar.importar_xml', '*');

insert into public.suppliers (id, name, active)
values ('95000000-0000-4000-8000-0000000000f1', '[TESTE] Fornecedor do fator', true);

-- Insumo cobrado em quilo; a NF-e vai cobrar em caixa.
insert into public.products (id, name, category, active, unit, kind, cost_price)
values ('95000000-0000-4000-8000-0000000000d1', '[TESTE] Farinha do fator', 'Insumos', true, 'kg', 'insumo', 0);

-- Estrutura ----------------------------------------------------------------

select is(private.unidade_familia('KG'), 'peso', 'KG é peso');
select is(private.unidade_familia('UN.'), 'desconhecida', 'unidade que a lista não conhece não força conferência');
select ok(exists(
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'payable_purchase_items' and column_name = 'discount_value'),
  'o item da NF-e guarda o desconto');
select ok((
  select generation_expression ilike '%discount_value%'
  from information_schema.columns
  where table_schema = 'public' and table_name = 'payable_purchase_items' and column_name = 'line_total'),
  'o valor do item passa a descontar o desconto');

-- Comportamento ------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000000b', true);

select throws_ok(
  $$select public.create_xml_payable(
      '95000000-0000-4000-8000-000000000001'::uuid, '35260800000000000000550010000000011000000011',
      '95000000-0000-4000-8000-0000000000f1'::uuid, '1', '1', current_date, 'boleto', 100.00, '',
      '[{"line_number":1,"source_description":"FARINHA CAIXA 2KG","source_unit":"CX","source_quantity":1,
         "product_id":"95000000-0000-4000-8000-0000000000d1","conversion_basis":"package","conversion_factor":2,
         "usable_quantity":2,"line_total":100.00,"unit_price":100.00,"discount_value":0,"factor_confirmed":true,
         "remember_conversion":false}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-09-09","amount":100.00}]'::jsonb)$$,
  '42501', 'Sem permissão para importar XML.',
  'quem não tem a permissão não importa NF-e');

set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000000a', true);

-- A trava: caixa contra quilo, fator 1, e ninguém conferiu.
select throws_ok(
  $$select public.create_xml_payable(
      '95000000-0000-4000-8000-000000000002'::uuid, '35260800000000000000550010000000021000000021',
      '95000000-0000-4000-8000-0000000000f1'::uuid, '2', '1', current_date, 'boleto', 100.00, '',
      '[{"line_number":1,"source_description":"FARINHA CAIXA 25KG","source_unit":"CX","source_quantity":1,
         "product_id":"95000000-0000-4000-8000-0000000000d1","conversion_basis":"simple","conversion_factor":1,
         "usable_quantity":1,"line_total":100.00,"unit_price":100.00,"discount_value":0,"factor_confirmed":false,
         "remember_conversion":false}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-09-09","amount":100.00}]'::jsonb)$$,
  '22023', 'Confira quanto vem na embalagem: a NF-e cobra em CX e a receita usa kg.',
  'fator 1 entre familias diferentes nao passa sem alguem conferir');

-- Valor do item que não bate com quantidade, preço e desconto.
select throws_ok(
  $$select public.create_xml_payable(
      '95000000-0000-4000-8000-000000000003'::uuid, '35260800000000000000550010000000031000000031',
      '95000000-0000-4000-8000-0000000000f1'::uuid, '3', '1', current_date, 'boleto', 100.00, '',
      '[{"line_number":1,"source_description":"FARINHA CAIXA 25KG","source_unit":"CX","source_quantity":1,
         "product_id":null,"conversion_basis":"simple","conversion_factor":null,
         "usable_quantity":null,"line_total":100.00,"unit_price":120.00,"discount_value":5,"factor_confirmed":true,
         "remember_conversion":false}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-09-09","amount":100.00}]'::jsonb)$$,
  '22023', 'O valor do item não confere com quantidade, preço e desconto.',
  'valor do item precisa bater com quantidade, preco e desconto');

-- Conferido: passa, e o custo sai do líquido dividido pelo aproveitável.
select lives_ok(
  $$select public.create_xml_payable(
      '95000000-0000-4000-8000-000000000004'::uuid, '35260800000000000000550010000000041000000041',
      '95000000-0000-4000-8000-0000000000f1'::uuid, '4', '1', current_date, 'boleto', 95.00, '',
      '[{"line_number":1,"source_description":"FARINHA CAIXA 25KG","source_unit":"CX","source_quantity":1,
         "product_id":"95000000-0000-4000-8000-0000000000d1","conversion_basis":"package","conversion_factor":25,
         "usable_quantity":25,"line_total":95.00,"unit_price":100.00,"discount_value":5,"factor_confirmed":true,
         "remember_conversion":false}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-09-09","amount":95.00}]'::jsonb)$$,
  'fator conferido passa, com desconto no item');

-- As conferencias abaixo leem a tabela direto: como authenticated a RLS esconde
-- a linha do proprio teste e a asserção compara com NULL sem dizer por que.
reset role;

select is(
  (select line_total from public.payable_purchase_items
   where source_description = 'FARINHA CAIXA 25KG' and discount_value = 5),
  95.00::numeric(12,2),
  'o valor gravado do item e o liquido, nao o bruto');

select is(
  (select discount_value from public.payable_purchase_items
   where source_description = 'FARINHA CAIXA 25KG' and discount_value = 5),
  5.00::numeric(12,2),
  'o desconto do item fica guardado');

select is(
  (select cost_price from public.products where id = '95000000-0000-4000-8000-0000000000d1'),
  3.80::numeric,
  'custo do insumo sai do liquido dividido pelo aproveitavel (95 / 25)');

select isnt(
  (select factor_confirmed_at from public.payable_purchase_items
   where source_description = 'FARINHA CAIXA 25KG' and discount_value = 5),
  null,
  'fica registrado quando o fator foi conferido');

-- O site que está no ar não manda os campos novos e precisa seguir funcionando.
set local role authenticated;
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-00000000000a', true);

select lives_ok(
  $$select public.create_xml_payable(
      '95000000-0000-4000-8000-000000000005'::uuid, '35260800000000000000550010000000051000000051',
      '95000000-0000-4000-8000-0000000000f1'::uuid, '5', '1', current_date, 'boleto', 100.00, '',
      '[{"line_number":1,"source_description":"FARINHA SITE ANTIGO","source_unit":"CX","source_quantity":1,
         "product_id":"95000000-0000-4000-8000-0000000000d1","conversion_basis":"simple","conversion_factor":1,
         "usable_quantity":1,"line_total":100.00,"unit_price":100.00,
         "remember_conversion":false}]'::jsonb,
      '[{"installment_number":1,"due_date":"2026-09-09","amount":100.00}]'::jsonb)$$,
  'site anterior, sem os campos novos, continua importando na janela do deploy');

select * from finish();
rollback;
