begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

select ok(
  has_function_privilege(
    'authenticated',
    'public.get_romaneio_production_composition(date, text)',
    'execute'
  ),
  'Expedicao autenticada pode consultar a composicao do Romaneio'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.get_romaneio_production_composition(date, text)',
    'execute'
  ),
  'Anonimo nao pode consultar a composicao do Romaneio'
);

insert into public.production_plans (
  id, production_date, status, created_by, created_by_name
)
select
  '70000000-0000-4000-8000-000000000001',
  current_date + 60,
  'aguardando_geolar',
  user_account.id,
  'Teste composicao'
from auth.users user_account
where lower(user_account.email) = 'rodrigao+teste@gmail.com';

insert into public.production_plan_items (
  id, plan_id, store, bread_id, planned_quantity, frozen_quantity,
  leftover_proposed_quantity, leftover_confirmed_quantity
)
values (
  '71000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'jc',
  'teste-baguete',
  10,
  5,
  2,
  null
);

insert into public.bread_reuse_plans (
  id, target_production_date, store, bread_id, proposed_quantity,
  confirmed_quantity, status, proposed_by, proposed_by_name
)
select
  '72000000-0000-4000-8000-000000000001',
  current_date + 60,
  'jc',
  'teste-baguete',
  2,
  2,
  'confirmed',
  user_account.id,
  'Teste composicao'
from auth.users user_account
where lower(user_account.email) = 'rodrigao+teste@gmail.com';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  (select user_account.id::text from auth.users user_account where lower(user_account.email) = 'rodrigao+teste-expedicao-jc@gmail.com'),
  true
);

select is(
  (select planned_quantity from public.get_romaneio_production_composition(current_date + 60, 'jc') where bread_id = 'teste-baguete'),
  10::numeric,
  'Expedicao recebe o total planejado'
);
select is(
  (select frozen_quantity from public.get_romaneio_production_composition(current_date + 60, 'jc') where bread_id = 'teste-baguete'),
  5::numeric,
  'Expedicao recebe a quantidade congelada'
);
select is(
  (select leftover_quantity from public.get_romaneio_production_composition(current_date + 60, 'jc') where bread_id = 'teste-baguete'),
  2::numeric,
  'Expedicao recebe a sobra confirmada'
);
select is(
  (select new_quantity from public.get_romaneio_production_composition(current_date + 60, 'jc') where bread_id = 'teste-baguete'),
  3::numeric,
  'Expedicao recebe a producao nova residual'
);

select throws_ok(
  $$ select * from public.get_romaneio_production_composition(current_date + 60, 'ja') $$,
  '42501',
  'Sem permissao para consultar a composicao desta loja.',
  'Expedicao JC nao consulta a composicao da JA'
);

select throws_ok(
  $$ select * from public.get_romaneio_production_composition(current_date + 60, 'ex') $$,
  '22023',
  'Data ou loja inválida para a composição do Romaneio.',
  'EX nao usa o planejamento de JC e JA'
);

select set_config(
  'request.jwt.claim.sub',
  (select user_account.id::text from auth.users user_account where lower(user_account.email) = 'rodrigao+teste@gmail.com'),
  true
);
select is(
  (select new_quantity from public.get_romaneio_production_composition(current_date + 60, 'jc') where bread_id = 'teste-baguete'),
  3::numeric,
  'Admin tambem recebe a composicao residual'
);

select set_config(
  'request.jwt.claim.sub',
  (select user_account.id::text from auth.users user_account where lower(user_account.email) = 'rodrigao+teste-expedicao-jc@gmail.com'),
  true
);
select throws_ok(
  $$ select * from public.get_romaneio_production_composition(null::date, 'jc') $$,
  '22023',
  'Data ou loja inválida para a composição do Romaneio.',
  'Data ausente e rejeitada'
);

select * from finish();
rollback;
