-- Fase 2 do saneamento do catálogo: consumidores de variantes de produtos.
-- Este arquivo cresce por incremento nesta fase; começa pela correção de
-- unicidade de nome de variante por acento/caixa/espaço.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.products (id, name, kind, is_fabricacao_propria)
values ('c9100000-0000-4000-8000-000000000001', '[TESTE] Brioche Consumidores', 'final', true);

insert into public.product_variants (id, product_id, name, sort_order)
values ('c9100000-0000-4000-8000-000000000011', 'c9100000-0000-4000-8000-000000000001', 'Hamburguer', 1);

-- A fase 1 usava lower(btrim(name)) e deixava passar "Hambúrguer" como uma
-- segunda variante distinta da já cadastrada "Hamburguer". A correção desta
-- fase reaproveita private.normalize_product_category_name, que decompõe
-- Unicode (NFD) e apaga marca de acento antes de comparar.
select throws_ok(
  $$insert into public.product_variants (product_id, name) values
    ('c9100000-0000-4000-8000-000000000001', 'Hambúrguer')$$,
  '23505', null,
  'variante com acento é reconhecida como a mesma variante já cadastrada sem acento');

select throws_ok(
  $$insert into public.product_variants (product_id, name) values
    ('c9100000-0000-4000-8000-000000000001', '  HAMBÚRGUER  ')$$,
  '23505', null,
  'variação de acento, caixa e espaço nas pontas continua sendo a mesma variante');

-- Nomes realmente distintos continuam sendo aceitos normalmente.
select lives_ok(
  $$insert into public.product_variants (product_id, name) values
    ('c9100000-0000-4000-8000-000000000001', 'Forma')$$,
  'variante com nome realmente distinto continua sendo aceita');

-- A fase 1 trocou UNIQUE(product_id) por dois índices únicos parciais em
-- product_recipe_yields (um para produto sem variante, outro por variante).
-- Um upsert por ON CONFLICT(product_id), sem repetir o predicado da parcial,
-- não encontra árbitro e falha: é exatamente o padrão que
-- src/app/produtos/composicao/page.tsx usava antes desta fase para gravar
-- rendimento de QUALQUER produto, inclusive legado sem variante. Documentado
-- aqui para que ninguém reintroduza esse padrão.
insert into public.products (id, name, kind, is_fabricacao_propria)
values ('c9100000-0000-4000-8000-000000000002', '[TESTE] Baguete Legada Consumidores', 'final', true);

select throws_ok(
  $$insert into public.product_recipe_yields (product_id, basis, finished_weight_kg, yield_units)
    values ('c9100000-0000-4000-8000-000000000002', 'baked', 1, 4)
    on conflict (product_id) do update set finished_weight_kg = excluded.finished_weight_kg$$,
  null,
  'there is no unique or exclusion constraint matching the ON CONFLICT specification',
  'upsert por ON CONFLICT(product_id) não encontra árbitro nos índices parciais, nem para produto legado');

-- O padrão corrigido (usado pelo cliente): insere se não existe, atualiza
-- por id se já existe. Funciona tanto para produto legado (sem variante)
-- quanto por variante, sem depender de inferência de índice parcial.
insert into public.product_recipe_yields (product_id, basis, finished_weight_kg, yield_units)
values ('c9100000-0000-4000-8000-000000000002', 'baked', 1, 4);

select lives_ok(
  $$update public.product_recipe_yields set finished_weight_kg = 2, yield_units = 8
    where product_id = 'c9100000-0000-4000-8000-000000000002' and product_variant_id is null$$,
  'atualização explícita por id/produto substitui o upsert quebrado para produto legado');

select is((select finished_weight_kg from public.product_recipe_yields
  where product_id = 'c9100000-0000-4000-8000-000000000002' and product_variant_id is null),
  2::numeric, 'a atualização explícita realmente gravou o novo peso do produto legado');

select * from finish();
rollback;
