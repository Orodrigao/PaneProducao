-- O catálogo alimenta os pães das lojas (migration 20261010133725).
-- Marcar "Lojas" cria e liga o pão que Planejamento, pedido das lojas, Forno e
-- Romaneio leem; nome, dias e ativo descem do produto só quando mudam; item PJ
-- antigo não é tocado. Os blocos "migration (cópia)" repetem ao pé da letra os
-- comandos de dado da migration, contra fixtures que caem e que não caem nos
-- filtros, porque no banco de teste a migration rodou sem dado nenhum.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------------------
-- Estrutura
-- ---------------------------------------------------------------------------

select is((select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'products' and column_name = 'is_loja'),
  'false', 'produto nasce fora das lojas, a menos que alguém marque');
select ok((select prosecdef from pg_proc procedure join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private' and procedure.proname = 'sincronizar_pao_das_lojas'),
  'a sincronização grava o pão mesmo quando quem edita o produto não escreve em breads');
select ok((select proconfig from pg_proc procedure join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private' and procedure.proname = 'sincronizar_pao_das_lojas') @> array['search_path=""'],
  'a função privilegiada fixa o search_path vazio');
select ok(not has_function_privilege('authenticated', 'private.sincronizar_pao_das_lojas()', 'execute'),
  'perfil logado não chama a função de sincronização direto');
select ok(not has_function_privilege('anon', 'private.sincronizar_pao_das_lojas()', 'execute'),
  'visitante anônimo não chama a função de sincronização');
select ok((select pg_get_triggerdef(trigger.oid) from pg_trigger trigger
    where trigger.tgrelid = 'public.products'::regclass and trigger.tgname = 'sincronizar_pao_das_lojas_antes_de_gravar_produto')
    ilike all(array['%BEFORE INSERT OR UPDATE OF name, production_days, active, is_loja%', '%FOR EACH ROW%']),
  'o gatilho roda antes de gravar, só quando nome, dias, ativo ou Lojas mudam');

-- ---------------------------------------------------------------------------
-- Cadastro novo marcado Lojas
-- ---------------------------------------------------------------------------

insert into public.products (
  id, name, category, active, unit, kind, is_fabricacao_propria, is_pj, production_days,
  production_area, production_process, allows_planned_production, allows_unplanned_production, is_loja
) values
  ('95100000-0000-4000-8000-000000000001', '  [TESTE] Rústico de sábado ', 'Pães Integ.', true, 'un', 'final', true, false, '{6}',
   'padaria', 'forno', true, true, true),
  ('95100000-0000-4000-8000-000000000002', '[TESTE] Fora das lojas', 'Pães Integ.', true, 'un', 'final', true, false, '{6}',
   'padaria', 'forno', true, true, false),
  ('95100000-0000-4000-8000-000000000003', '[TESTE] Pão por quilo', 'Pães', true, 'KG', 'final', true, false, '{1,2}',
   'padaria', 'forno', true, false, true),
  ('95100000-0000-4000-8000-000000000004', '[TESTE] Pão de cadastro antigo', 'Pães', true, 'un', 'final', true, false, '{3}',
   'padaria', null, null, null, true);

select is((select legacy_bread_id from public.products where id = '95100000-0000-4000-8000-000000000001'),
  'catalogo_95100000000040008000000000000001'::text, 'marcar Lojas liga o produto a um pão com identificador próprio');
select is((select row(name, days, active, is_pj, unit)::text from public.breads
    where id = 'catalogo_95100000000040008000000000000001'),
  row('[TESTE] Rústico de sábado', '{6}'::integer[], true, false, 'un')::text,
  'o pão nasce com o nome, os dias e o ativo do catálogo, como pão das lojas');
select is((select legacy_bread_id from public.products where id = '95100000-0000-4000-8000-000000000002'),
  null, 'produto sem Lojas não ganha pão');
select is((select count(*)::integer from public.breads where id = 'catalogo_95100000000040008000000000000002'),
  0, 'nenhum pão sobra para quem não está marcado');
select is((select unit from public.breads where id = 'catalogo_95100000000040008000000000000003'),
  'kg', 'produto por quilo (grafia KG) vira pão por quilo');
select is((select unit from public.breads where id = 'catalogo_95100000000040008000000000000004'),
  'un', 'produto ainda sem processo revisado também vai para as lojas');

-- A lista que Planejamento e Romaneio leem passa a ter o pão novo.
select ok(exists(select 1 from public.breads
    where id = 'catalogo_95100000000040008000000000000001' and active and not is_pj and 6 = any(days)),
  'o pão aparece no filtro do Planejamento de sábado e da busca do Romaneio');

-- ---------------------------------------------------------------------------
-- Mudanças no catálogo descem para o pão
-- ---------------------------------------------------------------------------

update public.products set production_days = '{4,6}' where id = '95100000-0000-4000-8000-000000000001';
select is((select days from public.breads where id = 'catalogo_95100000000040008000000000000001'),
  '{4,6}'::integer[], 'trocar os dias no catálogo troca os dias da produção');

update public.products set name = '[TESTE] Rústico renomeado' where id = '95100000-0000-4000-8000-000000000001';
select is((select name from public.breads where id = 'catalogo_95100000000040008000000000000001'),
  '[TESTE] Rústico renomeado', 'renomear no catálogo renomeia o pão');

-- Nome curto que a equipe já usa fica até alguém renomear o produto: salvar o
-- cadastro com o mesmo nome (a tela reenvia todos os campos) não mexe nele.
update public.breads set name = '[TESTE] Rústico' where id = 'catalogo_95100000000040008000000000000001';
update public.products
set name = name, production_days = production_days, cost_price = 3.10
where id = '95100000-0000-4000-8000-000000000001';
select is((select row(name, days)::text from public.breads where id = 'catalogo_95100000000040008000000000000001'),
  row('[TESTE] Rústico', '{4,6}'::integer[])::text,
  'salvar sem mudar nome nem dias preserva o nome curto do pão');

update public.products set active = false where id = '95100000-0000-4000-8000-000000000001';
select is((select active from public.breads where id = 'catalogo_95100000000040008000000000000001'),
  false, 'inativar no catálogo tira o pão da produção');
update public.products set active = true where id = '95100000-0000-4000-8000-000000000001';
select is((select active from public.breads where id = 'catalogo_95100000000040008000000000000001'),
  true, 'reativar no catálogo devolve o pão');
update public.products set is_loja = false where id = '95100000-0000-4000-8000-000000000001';
select is((select active from public.breads where id = 'catalogo_95100000000040008000000000000001'),
  false, 'desmarcar Lojas tira o pão da produção sem apagar o histórico');
select is((select legacy_bread_id from public.products where id = '95100000-0000-4000-8000-000000000001'),
  'catalogo_95100000000040008000000000000001'::text, 'a ligação fica para a volta');
update public.products set is_loja = true where id = '95100000-0000-4000-8000-000000000001';
select is((select active from public.breads where id = 'catalogo_95100000000040008000000000000001'),
  true, 'marcar Lojas de novo reativa o mesmo pão');
select is((select count(*)::integer from public.breads where name like '[TESTE] Rústico%'),
  1, 'ida e volta não cria pão repetido');

update public.products set is_loja = true where id = '95100000-0000-4000-8000-000000000002';
select is((select row(legacy_bread_id, (select active from public.breads where id = 'catalogo_95100000000040008000000000000002'))::text
    from public.products where id = '95100000-0000-4000-8000-000000000002'),
  row('catalogo_95100000000040008000000000000002', true)::text,
  'marcar Lojas num produto que já existia cria o pão nessa hora');

-- Produto inativo marcado Lojas ganha o pão já inativo.
insert into public.products (
  id, name, active, unit, kind, is_fabricacao_propria, production_days,
  production_area, production_process, allows_planned_production, allows_unplanned_production, is_loja
) values ('95100000-0000-4000-8000-000000000005', '[TESTE] Inativo nas lojas', false, 'un', 'final', true, '{6}',
  'padaria', 'forno', true, true, true);
select is((select active from public.breads where id = 'catalogo_95100000000040008000000000000005'),
  false, 'produto inativo não aparece na produção');

-- ---------------------------------------------------------------------------
-- Item PJ antigo e ligação quebrada
-- ---------------------------------------------------------------------------

insert into public.breads (id, name, days, active, is_pj, unit)
values ('teste-ponte-item-pj', '[TESTE] Item PJ antigo', '{0,1,2,3,4,5,6}', true, true, 'un');
insert into public.products (id, name, active, unit, kind, is_fabricacao_propria, is_pj, production_days, legacy_bread_id)
values ('95100000-0000-4000-8000-000000000006', '[TESTE] Produto do item PJ', true, 'un', 'final', true, true, '{1}',
  'teste-ponte-item-pj');
update public.products set name = '[TESTE] Produto PJ renomeado', production_days = '{2}', active = false
where id = '95100000-0000-4000-8000-000000000006';
select is((select row(name, days, active)::text from public.breads where id = 'teste-ponte-item-pj'),
  row('[TESTE] Item PJ antigo', '{0,1,2,3,4,5,6}'::integer[], true)::text,
  'item PJ antigo não é tocado pelo catálogo');
select throws_ok(
  $$update public.products set is_loja = true where id = '95100000-0000-4000-8000-000000000006'$$,
  'P0001', '"[TESTE] Produto PJ renomeado" está ligado a um item PJ antigo e não pode ser marcado Lojas.',
  'produto ligado a item PJ antigo não vira pão das lojas');

insert into public.products (id, name, active, unit, kind, is_fabricacao_propria, production_days, legacy_bread_id)
values ('95100000-0000-4000-8000-000000000007', '[TESTE] Ligação quebrada', true, 'un', 'final', true, '{1}',
  'teste-ponte-pao-que-nao-existe');
select lives_ok(
  $$update public.products set name = '[TESTE] Ligação quebrada editada' where id = '95100000-0000-4000-8000-000000000007'$$,
  'ligação quebrada não impede editar o produto que não vai para as lojas');
select throws_ok(
  $$update public.products set is_loja = true where id = '95100000-0000-4000-8000-000000000007'$$,
  'P0001', 'O pão ligado a "[TESTE] Ligação quebrada editada" não existe mais. Avise o administrador antes de marcar Lojas.',
  'ligação quebrada bloqueia marcar Lojas em vez de fingir que deu certo');

-- ---------------------------------------------------------------------------
-- Produto com histórico no próprio nome não é ligado pela tela
-- ---------------------------------------------------------------------------

insert into public.products (
  id, name, active, unit, kind, is_fabricacao_propria, is_pj, production_days,
  production_area, production_process, allows_planned_production, allows_unplanned_production
) values
  ('95100000-0000-4000-8000-000000000008', '[TESTE] PJ com variação', true, 'un', 'final', true, true, '{1}',
   'padaria', 'forno', true, true),
  ('95100000-0000-4000-8000-000000000009', '[TESTE] PJ com estoque', true, 'un', 'final', true, true, '{1}',
   'padaria', 'forno', true, true);
insert into public.product_variants (id, product_id, name)
values ('95100000-0000-4000-8000-000000000081', '95100000-0000-4000-8000-000000000008', 'Pacote com 6');
insert into public.bread_movements (movement_type, bread_id, product_source, product_id, location, quantity, recorded_by)
values ('forno_entrada', null, 'product', '95100000-0000-4000-8000-000000000009', 'central', 4, 'Teste');

select throws_ok(
  $$update public.products set is_loja = true where id = '95100000-0000-4000-8000-000000000008'$$,
  'P0001', '"[TESTE] PJ com variação" já tem produção, estoque ou variações registradas no próprio cadastro. Ligar agora dividiria esse histórico em dois; peça ao administrador para fazer a passagem.',
  'produto com variação não ganha pão pela tela (o Forno juntaria as variações num lote só)');
select throws_ok(
  $$update public.products set is_loja = true where id = '95100000-0000-4000-8000-000000000009'$$,
  'P0001', '"[TESTE] PJ com estoque" já tem produção, estoque ou variações registradas no próprio cadastro. Ligar agora dividiria esse histórico em dois; peça ao administrador para fazer a passagem.',
  'produto com estoque no próprio nome não ganha pão pela tela (o saldo sumiria da tela de estoque)');
select is((select count(*)::integer from public.breads where id in (
    'catalogo_95100000000040008000000000000008', 'catalogo_95100000000040008000000000000009')),
  0, 'a recusa não deixa pão para trás');

-- O pão novo nasce com o custo do produto, para Sobras não mostrar "sem custo".
insert into public.products (
  id, name, active, unit, kind, is_fabricacao_propria, production_days, cost_price,
  production_area, production_process, allows_planned_production, allows_unplanned_production, is_loja
) values ('95100000-0000-4000-8000-000000000010', '[TESTE] Pão com custo', true, 'un', 'final', true, '{2}', 4.35,
  'padaria', 'forno', true, true, true);
select is((select cost_price from public.breads where id = 'catalogo_95100000000040008000000000000010'),
  4.35::numeric, 'o pão novo nasce com o custo do produto');

-- Produto ligado que nunca foi das lojas (fora da regra) não perde o pão ao
-- ser inativado e reativado na lista.
insert into public.breads (id, name, days, active, is_pj, unit)
values ('teste-ponte-fora-regra', '[TESTE] Pão de kit antigo', '{1,2,3}', true, false, 'un');
insert into public.products (id, name, active, unit, kind, is_fabricacao_propria, production_days, legacy_bread_id)
values ('95100000-0000-4000-8000-000000000015', '[TESTE] Kit ligado a pão', true, 'un', 'kit', true, '{1,2,3}',
  'teste-ponte-fora-regra');
update public.products set active = false where id = '95100000-0000-4000-8000-000000000015';
update public.products set active = true where id = '95100000-0000-4000-8000-000000000015';
select is((select active from public.breads where id = 'teste-ponte-fora-regra'),
  true, 'inativar e reativar quem não é das lojas não tira o pão da produção');

-- ---------------------------------------------------------------------------
-- Só pão de forno, fabricação própria e produto final vai para as lojas
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.products (id, name, unit, kind, is_fabricacao_propria, production_area, production_process,
      allows_planned_production, allows_unplanned_production, is_loja)
    values ('95100000-0000-4000-8000-000000000011', '[TESTE] Sanduíche nas lojas', 'un', 'final', true, 'cozinha',
      'montagem', true, true, true)$$,
  '23514', 'new row for relation "products" violates check constraint "products_is_loja_requer_pao_de_forno"',
  'produto de montagem vai para a Cozinha, não para o Planejamento das lojas');
select throws_ok(
  $$insert into public.products (id, name, unit, kind, is_fabricacao_propria, is_loja)
    values ('95100000-0000-4000-8000-000000000012', '[TESTE] Revenda nas lojas', 'un', 'final', false, true)$$,
  '23514', 'new row for relation "products" violates check constraint "products_is_loja_requer_pao_de_forno"',
  'revenda não vira pão das lojas');
select throws_ok(
  $$insert into public.products (id, name, unit, kind, is_fabricacao_propria, is_loja)
    values ('95100000-0000-4000-8000-000000000013', '[TESTE] Kit nas lojas', 'un', 'kit', true, true)$$,
  '23514', 'new row for relation "products" violates check constraint "products_is_loja_requer_pao_de_forno"',
  'kit não vira pão das lojas');
select throws_ok(
  $$insert into public.products (id, name, unit, kind, is_fabricacao_propria, is_loja)
    values ('95100000-0000-4000-8000-000000000014', '[TESTE] Sem tipo nas lojas', 'un', null, true, true)$$,
  '23514', 'new row for relation "products" violates check constraint "products_is_loja_requer_pao_de_forno"',
  'produto sem tipo definido não passa pela trava');
select is((select count(*)::integer from public.breads where id in (
    'catalogo_95100000000040008000000000000011', 'catalogo_95100000000040008000000000000012',
    'catalogo_95100000000040008000000000000013', 'catalogo_95100000000040008000000000000014')),
  0, 'cadastro recusado não deixa pão para trás');

-- ---------------------------------------------------------------------------
-- Pela porta real: perfil logado do catálogo e perfil sem acesso
-- ---------------------------------------------------------------------------

insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin)
values
  ('95100000-0000-4000-8000-000000000050', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ponte-catalogo-admin@example.com', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('95100000-0000-4000-8000-000000000051', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ponte-catalogo-vendas@example.com', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false);
insert into public.app_profiles(user_id, display_name, role, store, active, allowed_routes)
values
  ('95100000-0000-4000-8000-000000000050', '[TESTE] Admin do catálogo', 'admin', 'jc', true, '["/produtos"]'),
  ('95100000-0000-4000-8000-000000000051', '[TESTE] Vendas JA', 'vendas', 'ja', true, '["/romaneio"]');

set local role authenticated;
select set_config('request.jwt.claim.sub', '95100000-0000-4000-8000-000000000050', true);
select lives_ok(
  $$insert into public.products (id, name, unit, kind, is_fabricacao_propria, is_pj, production_days,
      production_area, production_process, allows_planned_production, allows_unplanned_production, is_loja)
    values ('95100000-0000-4000-8000-000000000020', '[TESTE] Pão do admin', 'un', 'final', true, false, '{6}',
      'padaria', 'forno', true, true, true)$$,
  'quem cuida do catálogo cadastra o pão marcando Lojas');
select ok(exists(select 1 from public.breads where id = 'catalogo_95100000000040008000000000000020' and active),
  'o pão nasce para quem cadastrou pela tela');

select set_config('request.jwt.claim.sub', '95100000-0000-4000-8000-000000000051', true);
select ok(exists(select 1 from public.breads where id = 'catalogo_95100000000040008000000000000020' and active and not is_pj),
  'Vendas JA enxerga o pão novo na lista do Romaneio');
select throws_ok(
  $$insert into public.products (id, name, unit, kind, is_fabricacao_propria, is_loja)
    values ('95100000-0000-4000-8000-000000000021', '[TESTE] Pão de vendas', 'un', 'final', true, true)$$,
  '42501', 'new row violates row-level security policy for table "products"',
  'Vendas não cadastra produto, então não cria pão pela ponte');
reset role;
select is((select count(*)::integer from public.breads where id = 'catalogo_95100000000040008000000000000021'),
  0, 'a tentativa barrada não deixa pão para trás');

-- ---------------------------------------------------------------------------
-- Correções pontuais decididas pelo Rodrigo (cópia da migration)
-- ---------------------------------------------------------------------------

insert into public.breads (id, name, days, active, is_pj, unit) values
  ('pao_originale_mora1787723771684', 'Pão Originale (Mora)', '{4}', true, false, 'un'),
  ('pao_de_nozez1783037673222', 'Pão de Nozez', '{6}', true, false, 'un'),
  ('grande_arome1775678443844', 'Grande Arome', '{3}', true, false, 'un'),
  ('pao_de_tapioca1778572678568', 'Pão de Tapioca', '{2}', true, false, 'un'),
  ('paodehotdog1779743021606', 'Pão de Hotdog', '{0,1,2,3,4,5,6}', true, false, 'Un'),
  ('paodeaboborabaguetinha1779892520050', 'Pão de Abóbora (Baguetinha)', '{0,1,2,3,4,5,6}', true, true, 'un');
insert into public.products (id, name, active, unit, kind, is_fabricacao_propria, is_pj, production_days,
    production_area, production_process, allows_planned_production, allows_unplanned_production, legacy_bread_id)
values
  ('a72ab703-1fc0-47e0-a82a-ea04280b120e', 'Pão Originale (Mora)', true, 'un', 'final', true, false, '{4}', null, null, null, null, null),
  ('13ceeab0-49d0-4700-aa4d-5015431526c8', 'Pão de Nozes', true, 'un', 'final', true, false, '{}', null, null, null, null, null),
  ('3e47332b-8be2-42c8-8106-57f5a06ee041', 'Grand Arome', true, 'un', 'final', true, false, '{2}', null, null, null, null, 'grande_arome1775678443844'),
  ('427aa1d5-874e-45ed-92d8-9de8fb0b6e48', 'Pão de Tapioca', true, 'un', 'final', true, false, '{3}', null, null, null, null, 'pao_de_tapioca1778572678568'),
  ('888f9a70-ff75-45eb-b5fc-add486dc287c', 'Pão de Cachorro Quente', true, '', 'final', true, true, '{1,2,3,4,5,6}',
   'padaria', 'forno', true, true, 'paodehotdog1779743021606'),
  ('ab742bbc-3ade-4176-905b-61f27ff940c8', 'Pão de Abóbora (Baguetinha)', false, 'un', 'final', true, true, '{}', null, null, null, null, 'paodeaboborabaguetinha1779892520050');

-- migration (cópia)
update public.products product
set legacy_bread_id = 'pao_originale_mora1787723771684'
where product.id = 'a72ab703-1fc0-47e0-a82a-ea04280b120e'
  and product.name = 'Pão Originale (Mora)'
  and product.legacy_bread_id is null
  and exists (
    select 1 from public.breads bread
    where bread.id = 'pao_originale_mora1787723771684'
      and bread.name = 'Pão Originale (Mora)'
      and not bread.is_pj
  )
  and not exists (
    select 1 from public.products other
    where other.legacy_bread_id = 'pao_originale_mora1787723771684'
  );

update public.products product
set legacy_bread_id = 'pao_de_nozez1783037673222'
where product.id = '13ceeab0-49d0-4700-aa4d-5015431526c8'
  and product.name = 'Pão de Nozes'
  and product.legacy_bread_id is null
  and exists (
    select 1 from public.breads bread
    where bread.id = 'pao_de_nozez1783037673222'
      and bread.name = 'Pão de Nozez'
      and not bread.is_pj
  )
  and not exists (
    select 1 from public.products other
    where other.legacy_bread_id = 'pao_de_nozez1783037673222'
  );

update public.breads bread
set name = 'Pão de Nozes'
where bread.id = 'pao_de_nozez1783037673222'
  and bread.name = 'Pão de Nozez'
  and exists (
    select 1 from public.products product
    where product.id = '13ceeab0-49d0-4700-aa4d-5015431526c8'
      and product.legacy_bread_id = bread.id
  );

update public.products product
set production_days = '{6}'
where product.id = '13ceeab0-49d0-4700-aa4d-5015431526c8'
  and product.legacy_bread_id = 'pao_de_nozez1783037673222'
  and product.production_days = '{}'::integer[];

update public.products product
set production_days = '{3}'
where product.id = '3e47332b-8be2-42c8-8106-57f5a06ee041'
  and product.legacy_bread_id = 'grande_arome1775678443844'
  and product.production_days = '{2}'::integer[];

update public.products product
set production_days = '{2}'
where product.id = '427aa1d5-874e-45ed-92d8-9de8fb0b6e48'
  and product.legacy_bread_id = 'pao_de_tapioca1778572678568'
  and product.production_days = '{3}'::integer[];

update public.breads bread
set name = 'Pão de Cachorro Quente',
    days = '{1,2,3,4,5,6}'
where bread.id = 'paodehotdog1779743021606'
  and bread.name = 'Pão de Hotdog'
  and not bread.is_pj
  and exists (
    select 1 from public.products product
    where product.id = '888f9a70-ff75-45eb-b5fc-add486dc287c'
      and product.legacy_bread_id = bread.id
      and product.name = 'Pão de Cachorro Quente'
      and product.production_days = '{1,2,3,4,5,6}'::integer[]
  );

update public.breads bread
set active = false
where bread.id = 'paodeaboborabaguetinha1779892520050'
  and bread.is_pj
  and bread.active
  and exists (
    select 1 from public.products product
    where product.id = 'ab742bbc-3ade-4176-905b-61f27ff940c8'
      and product.legacy_bread_id = bread.id
      and product.active = false
  );

select is((select legacy_bread_id from public.products where id = 'a72ab703-1fc0-47e0-a82a-ea04280b120e'),
  'pao_originale_mora1787723771684'::text, 'Pão Originale (Mora) do catálogo fica ligado ao pão que a produção já usa');
select is((select row(product.legacy_bread_id, product.production_days, bread.name, bread.days)::text
    from public.products product join public.breads bread on bread.id = product.legacy_bread_id
    where product.id = '13ceeab0-49d0-4700-aa4d-5015431526c8'),
  row('pao_de_nozez1783037673222', '{6}'::integer[], 'Pão de Nozes', '{6}'::integer[])::text,
  'Pão de Nozes fica ligado, com o nome corrigido e o sábado nos dois cadastros');
select is((select row(product.production_days, bread.days)::text from public.products product
    join public.breads bread on bread.id = product.legacy_bread_id where product.id = '3e47332b-8be2-42c8-8106-57f5a06ee041'),
  row('{3}'::integer[], '{3}'::integer[])::text, 'Grand Arome na quarta nos dois cadastros');
select is((select row(product.production_days, bread.days)::text from public.products product
    join public.breads bread on bread.id = product.legacy_bread_id where product.id = '427aa1d5-874e-45ed-92d8-9de8fb0b6e48'),
  row('{2}'::integer[], '{2}'::integer[])::text, 'Tapioca na terça nos dois cadastros');
select is((select row(name, days, active)::text from public.breads where id = 'paodehotdog1779743021606'),
  row('Pão de Cachorro Quente', '{1,2,3,4,5,6}'::integer[], true)::text,
  'o pão do Hot Dog passa a se chamar Pão de Cachorro Quente, de segunda a sábado');
select is((select active from public.breads where id = 'paodeaboborabaguetinha1779892520050'),
  false, 'Pão de Abóbora sai de linha também na lista antiga');

-- Guarda: estado diferente do esperado não é tocado.
update public.breads set name = 'Pão de Hotdog Especial', days = '{0}' where id = 'paodehotdog1779743021606';
update public.products set production_days = '{5}' where id = '3e47332b-8be2-42c8-8106-57f5a06ee041';
update public.breads bread
set name = 'Pão de Cachorro Quente',
    days = '{1,2,3,4,5,6}'
where bread.id = 'paodehotdog1779743021606'
  and bread.name = 'Pão de Hotdog'
  and not bread.is_pj
  and exists (
    select 1 from public.products product
    where product.id = '888f9a70-ff75-45eb-b5fc-add486dc287c'
      and product.legacy_bread_id = bread.id
      and product.name = 'Pão de Cachorro Quente'
      and product.production_days = '{1,2,3,4,5,6}'::integer[]
  );
update public.products product
set production_days = '{3}'
where product.id = '3e47332b-8be2-42c8-8106-57f5a06ee041'
  and product.legacy_bread_id = 'grande_arome1775678443844'
  and product.production_days = '{2}'::integer[];
select is((select row(name, days)::text from public.breads where id = 'paodehotdog1779743021606'),
  row('Pão de Hotdog Especial', '{0}'::integer[])::text, 'pão com outro nome não é renomeado');
select is((select production_days from public.products where id = '3e47332b-8be2-42c8-8106-57f5a06ee041'),
  '{5}'::integer[], 'dia já mudado por alguém não é sobrescrito');

-- ---------------------------------------------------------------------------
-- Marcação Lojas (cópia da migration) contra fixtures de cada caso
-- ---------------------------------------------------------------------------

insert into public.breads (id, name, days, active, is_pj, unit) values
  ('teste-ponte-ativo', '[TESTE] Pão curto', '{1,2,3,4,5,6}', true, false, 'un'),
  ('teste-ponte-sazonal', '[TESTE] Cuca sazonal', '{4,5,6}', false, false, 'un'),
  ('teste-ponte-sopa', '[TESTE] Sopa fora de linha', '{1,2,3,4,5,6}', true, false, 'un'),
  ('teste-ponte-inativos', '[TESTE] Os dois inativos', '{2}', false, false, 'un'),
  ('teste-ponte-pj-2', '[TESTE] Item PJ ativo', '{0,1,2,3,4,5,6}', true, true, 'un');
insert into public.products (id, name, active, unit, kind, is_fabricacao_propria, is_pj, production_days,
    production_area, production_process, allows_planned_production, allows_unplanned_production, legacy_bread_id)
values
  ('95100000-0000-4000-8000-000000000031', '[TESTE] Pão com nome longo', true, 'un', 'final', true, true, '{1,2,3,4,5,6}',
   null, null, null, null, 'teste-ponte-ativo'),
  ('95100000-0000-4000-8000-000000000032', '[TESTE] Cuca sazonal', true, 'un', 'final', true, false, '{4,5,6}',
   null, null, null, null, 'teste-ponte-sazonal'),
  ('95100000-0000-4000-8000-000000000033', '[TESTE] Sopa fora de linha', false, 'un', 'final', true, false, '{1,2,3,4,5,6}',
   null, null, null, null, 'teste-ponte-sopa'),
  ('95100000-0000-4000-8000-000000000034', '[TESTE] Os dois inativos', false, 'un', 'final', true, false, '{2}',
   null, null, null, null, 'teste-ponte-inativos'),
  ('95100000-0000-4000-8000-000000000035', '[TESTE] Produto de item PJ', true, 'un', 'final', true, true, '{1}',
   null, null, null, null, 'teste-ponte-pj-2'),
  -- sem pão ligado
  ('95100000-0000-4000-8000-000000000041', '[TESTE] Novo de forno', true, 'un', 'final', true, false, '{6}',
   'padaria', 'forno', true, true, null),
  ('95100000-0000-4000-8000-000000000042', '[TESTE] Novo de forno PJ', true, 'un', 'final', true, true, '{1}',
   'padaria', 'forno', true, true, null),
  ('95100000-0000-4000-8000-000000000043', '[TESTE] Novo sem processo', true, 'un', 'final', true, false, '{1}',
   null, null, null, null, null),
  ('95100000-0000-4000-8000-000000000044', '[TESTE] Novo inativo', false, 'un', 'final', true, false, '{1}',
   'padaria', 'forno', true, true, null),
  ('95100000-0000-4000-8000-000000000045', '[TESTE] Novo de montagem', true, 'un', 'final', true, false, '{1}',
   'cozinha', 'montagem', true, true, null);

-- migration (cópia)
update public.products product
set is_loja = true
from public.breads bread
where bread.id = product.legacy_bread_id
  and not bread.is_pj
  and (bread.active or product.active = false)
  and product.is_fabricacao_propria
  and product.kind = 'final'
  and coalesce(product.production_process, 'forno') = 'forno';

update public.products product
set is_loja = true
where product.legacy_bread_id is null
  and product.is_fabricacao_propria
  and product.kind = 'final'
  and product.production_process = 'forno'
  and not product.is_pj
  and product.active is distinct from false;

select is((select row(product.is_loja, bread.name, bread.active)::text from public.products product
    join public.breads bread on bread.id = product.legacy_bread_id where product.id = '95100000-0000-4000-8000-000000000031'),
  row(true, '[TESTE] Pão curto', true)::text,
  'pão das lojas ativo fica marcado, com o nome curto e na produção, mesmo vendido também para PJ');
select is((select row(product.is_loja, bread.active)::text from public.products product
    join public.breads bread on bread.id = product.legacy_bread_id where product.id = '95100000-0000-4000-8000-000000000032'),
  row(false, false)::text, 'sazonal ativo no catálogo e fora da produção continua fora');
select is((select row(product.is_loja, bread.active)::text from public.products product
    join public.breads bread on bread.id = product.legacy_bread_id where product.id = '95100000-0000-4000-8000-000000000033'),
  row(true, false)::text, 'inativo no catálogo sai da produção e fica marcado para voltar se reativado');
select is((select row(product.is_loja, bread.active)::text from public.products product
    join public.breads bread on bread.id = product.legacy_bread_id where product.id = '95100000-0000-4000-8000-000000000034'),
  row(true, false)::text, 'inativo dos dois lados fica marcado e fora da produção');
select is((select row(product.is_loja, bread.active)::text from public.products product
    join public.breads bread on bread.id = product.legacy_bread_id where product.id = '95100000-0000-4000-8000-000000000035'),
  row(false, true)::text, 'item PJ antigo fica como está');
select is((select row(product.is_loja, product.legacy_bread_id, bread.name, bread.days, bread.active)::text
    from public.products product join public.breads bread on bread.id = product.legacy_bread_id
    where product.id = '95100000-0000-4000-8000-000000000041'),
  row(true, 'catalogo_95100000000040008000000000000041', '[TESTE] Novo de forno', '{6}'::integer[], true)::text,
  'pão de forno cadastrado só no catálogo ganha o pão que faltava');
select is((select array_agg(is_loja::text || ':' || coalesce(legacy_bread_id, '-') order by id) from public.products
    where id in ('95100000-0000-4000-8000-000000000042', '95100000-0000-4000-8000-000000000043',
      '95100000-0000-4000-8000-000000000044', '95100000-0000-4000-8000-000000000045')),
  array['false:-', 'false:-', 'false:-', 'false:-'],
  'PJ, sem processo, inativo e montagem ficam de fora da marcação automática');

-- Na ordem da migration, as correções pontuais vêm antes: os gêmeos ligados
-- e os pães corrigidos também ficam marcados, e o item PJ antigo não.
select is((select array_agg(product.name || ':' || product.is_loja::text || ':' || bread.active::text order by product.name collate "C")
    from public.products product join public.breads bread on bread.id = product.legacy_bread_id
    where product.id in ('a72ab703-1fc0-47e0-a82a-ea04280b120e', '13ceeab0-49d0-4700-aa4d-5015431526c8',
      '3e47332b-8be2-42c8-8106-57f5a06ee041', '427aa1d5-874e-45ed-92d8-9de8fb0b6e48',
      '888f9a70-ff75-45eb-b5fc-add486dc287c', 'ab742bbc-3ade-4176-905b-61f27ff940c8')),
  array['Grand Arome:true:true', 'Pão Originale (Mora):true:true', 'Pão de Abóbora (Baguetinha):false:false',
    'Pão de Cachorro Quente:true:true', 'Pão de Nozes:true:true', 'Pão de Tapioca:true:true'],
  'gêmeos e pães corrigidos ficam nas lojas; o item PJ de abóbora fica fora');

-- migration (cópia), de novo: não cria nada a mais
select set_config('teste.paes_antes_da_repeticao', (select count(*) from public.breads)::text, true);

update public.products product
set is_loja = true
from public.breads bread
where bread.id = product.legacy_bread_id
  and not bread.is_pj
  and (bread.active or product.active = false)
  and product.is_fabricacao_propria
  and product.kind = 'final'
  and coalesce(product.production_process, 'forno') = 'forno';

update public.products product
set is_loja = true
where product.legacy_bread_id is null
  and product.is_fabricacao_propria
  and product.kind = 'final'
  and product.production_process = 'forno'
  and not product.is_pj
  and product.active is distinct from false;

select is((select count(*)::integer from public.breads), current_setting('teste.paes_antes_da_repeticao')::integer,
  'rodar de novo não cria pão repetido');
select is((select active from public.breads where id = 'teste-ponte-sazonal'),
  false, 'rodar de novo não traz o sazonal de volta');

-- A trava existe no estado final.
select ok((select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.products'::regclass and conname = 'products_is_loja_requer_pao_de_forno')
    ilike all(array['%is_loja%', '%is_fabricacao_propria%', '%final%', '%forno%']),
  'a trava de Lojas está no banco');

select * from finish();
rollback;
