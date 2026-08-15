-- Comportamento da fila de reposicao: a conferencia da EX cria uma pendencia
-- operacional para o proximo envio quando o aceito fica menor que o enviado.

begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin
) values (
  '90000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'romaneio-reposicao-test@example.com',
  '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  false
);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values (
  '90000000-0000-4000-8000-000000000001',
  'Teste Reposicao EX',
  'expedicao',
  'ex',
  true,
  '["/romaneio"]'::jsonb
);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values (
  '90000000-0000-4000-8000-000000000001',
  'romaneio.conferir_recebimento',
  'ex',
  null
), (
  '90000000-0000-4000-8000-000000000001',
  'romaneio.confirmar_saida',
  'ex',
  null
);

insert into public.romaneios (
  id,
  record_date,
  destination_id,
  trip_number,
  status,
  created_by,
  sent_by,
  sent_at
) values
  (
    '90000000-0000-4000-8000-000000000020',
    current_date,
    '20000000-0000-4000-8000-000000000003',
    91,
    'enviado',
    'Teste',
    'Teste',
    now()
  ),
  (
    '90000000-0000-4000-8000-000000000021',
    current_date,
    '20000000-0000-4000-8000-000000000003',
    82,
    'enviado',
    'Teste',
    'Teste',
    now()
  ),
  (
    '90000000-0000-4000-8000-000000000022',
    current_date,
    '20000000-0000-4000-8000-000000000003',
    93,
    'enviado',
    'Teste',
    'Teste',
    now()
  ),
  (
    '90000000-0000-4000-8000-000000000023',
    current_date,
    '20000000-0000-4000-8000-000000000003',
    94,
    'enviado',
    'Teste',
    'Teste',
    now()
  ),
  (
    '90000000-0000-4000-8000-000000000024',
    current_date,
    '20000000-0000-4000-8000-000000000003',
    95,
    'enviado',
    'Teste',
    'Teste',
    now()
  ),
  (
    '90000000-0000-4000-8000-000000000025',
    current_date,
    '20000000-0000-4000-8000-000000000003',
    96,
    'enviado',
    'Teste',
    'Teste',
    now()
  ),
  (
    '90000000-0000-4000-8000-000000000026',
    current_date,
    '20000000-0000-4000-8000-000000000003',
    97,
    'separado',
    'Teste',
    null,
    null
  ),
  (
    '90000000-0000-4000-8000-000000000027',
    current_date - 1,
    '20000000-0000-4000-8000-000000000003',
    98,
    'com_divergencia',
    'Teste',
    null,
    null
  ),
  (
    '90000000-0000-4000-8000-000000000028',
    current_date,
    '20000000-0000-4000-8000-000000000003',
    92,
    'com_divergencia',
    'Teste',
    null,
    null
  );

insert into public.romaneio_items (
  id,
  romaneio_id,
  product_id,
  product_source,
  product_name,
  qty_sent,
  unit_price,
  item_status
) values
  (
    '90000000-0000-4000-8000-000000000030',
    '90000000-0000-4000-8000-000000000020',
    'teste-baguete',
    'bread',
    '[TESTE] Baguete',
    10,
    1,
    'pendente'
  ),
  (
    '90000000-0000-4000-8000-000000000031',
    '90000000-0000-4000-8000-000000000021',
    'teste-vazio',
    'bread',
    '[TESTE] Vazio',
    5,
    1,
    'pendente'
  ),
  (
    '90000000-0000-4000-8000-000000000032',
    '90000000-0000-4000-8000-000000000022',
    'teste-parcial-a',
    'bread',
    '[TESTE] Parcial A',
    5,
    1,
    'pendente'
  ),
  (
    '90000000-0000-4000-8000-000000000033',
    '90000000-0000-4000-8000-000000000022',
    'teste-parcial-b',
    'bread',
    '[TESTE] Parcial B',
    6,
    1,
    'pendente'
  ),
  (
    '90000000-0000-4000-8000-000000000034',
    '90000000-0000-4000-8000-000000000023',
    'teste-duplicado-a',
    'bread',
    '[TESTE] Duplicado A',
    5,
    1,
    'pendente'
  ),
  (
    '90000000-0000-4000-8000-000000000035',
    '90000000-0000-4000-8000-000000000023',
    'teste-duplicado-b',
    'bread',
    '[TESTE] Duplicado B',
    6,
    1,
    'pendente'
  ),
  (
    '90000000-0000-4000-8000-000000000036',
    '90000000-0000-4000-8000-000000000024',
    'teste-aceito-maior',
    'bread',
    '[TESTE] Aceito Maior',
    5,
    1,
    'pendente'
  ),
  (
    '90000000-0000-4000-8000-000000000037',
    '90000000-0000-4000-8000-000000000025',
    'teste-completo-a',
    'bread',
    '[TESTE] Completo A',
    5,
    1,
    'pendente'
  ),
  (
    '90000000-0000-4000-8000-000000000038',
    '90000000-0000-4000-8000-000000000025',
    'teste-completo-b',
    'bread',
    '[TESTE] Completo B',
    6,
    1,
    'pendente'
  ),
  (
    '90000000-0000-4000-8000-000000000039',
    '90000000-0000-4000-8000-000000000026',
    'teste-baguete',
    'bread',
    '[TESTE] Baguete',
    4,
    1,
    'pendente'
  ),
  (
    '90000000-0000-4000-8000-000000000040',
    '90000000-0000-4000-8000-000000000027',
    'teste-baguete',
    'bread',
    '[TESTE] Baguete antiga',
    7,
    1,
    'divergencia'
  ),
  (
    '90000000-0000-4000-8000-000000000042',
    '90000000-0000-4000-8000-000000000028',
    'teste-baguete',
    'bread',
    '[TESTE] Baguete segunda viagem',
    3,
    1,
    'divergencia'
  );

insert into public.romaneio_replacement_pending (
  id,
  destination_id,
  source_romaneio_id,
  source_item_id,
  product_id,
  product_source,
  product_name,
  pending_quantity,
  status,
  created_by
) values (
  '90000000-0000-4000-8000-000000000041',
  '20000000-0000-4000-8000-000000000003',
  '90000000-0000-4000-8000-000000000027',
  '90000000-0000-4000-8000-000000000040',
  'teste-baguete',
  'bread',
  '[TESTE] Baguete antiga',
  7,
  'aberta',
  'Teste'
), (
  '90000000-0000-4000-8000-000000000043',
  '20000000-0000-4000-8000-000000000003',
  '90000000-0000-4000-8000-000000000028',
  '90000000-0000-4000-8000-000000000042',
  'teste-baguete',
  'bread',
  '[TESTE] Baguete segunda viagem',
  3,
  'aberta',
  'Teste'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);

select is(
  public.confirm_romaneio_receipt(
    '90000000-0000-4000-8000-000000000020',
    '[{
      "id": "90000000-0000-4000-8000-000000000030",
      "qty_received": 8,
      "qty_accepted": 8,
      "divergence_reason": "faltou na contagem",
      "obs": ""
    }]'::jsonb
  ),
  'com_divergencia',
  'conferencia EX com falta fecha romaneio com divergencia'
);

reset role;

select is(
  (
    select pending_quantity
    from public.romaneio_replacement_pending
    where source_item_id = '90000000-0000-4000-8000-000000000030'
  ),
  2::numeric,
  'conferencia EX cria pendencia de reposicao por enviado menos aceito'
);

select is(
  (
    select status
    from public.romaneio_replacement_pending
    where source_item_id = '90000000-0000-4000-8000-000000000030'
  ),
  'aberta',
  'pendencia nasce aberta para a proxima viagem'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select public.confirm_romaneio_departure('90000000-0000-4000-8000-000000000026') $$,
  'saida seguinte da EX baixa a reposicao aberta no mesmo dia'
);

reset role;

select is(
  (
    select pending_quantity
    from public.romaneio_replacement_pending
    where source_item_id = '90000000-0000-4000-8000-000000000030'
  ),
  0::numeric,
  'reposicao baixada nao permanece como saldo acumulado'
);

select is(
  (
    select status
    from public.romaneio_replacement_pending
    where source_item_id = '90000000-0000-4000-8000-000000000030'
  ),
  'baixada',
  'reposicao enviada fica baixada'
);

select is(
  (
    select pending_quantity
    from public.romaneio_replacement_pending
    where id = '90000000-0000-4000-8000-000000000043'
  ),
  1::numeric,
  'baixa parcial deixa somente o saldo da segunda falta'
);

select is(
  (
    select status
    from public.romaneio_replacement_pending
    where id = '90000000-0000-4000-8000-000000000043'
  ),
  'aberta',
  'baixa parcial preserva aberta a falta nao reposta'
);

select is(
  (
    select pending_quantity
    from public.romaneio_replacement_pending
    where id = '90000000-0000-4000-8000-000000000041'
  ),
  7::numeric,
  'saldo de dia anterior preserva a quantidade para auditoria'
);

select is(
  (
    select status
    from public.romaneio_replacement_pending
    where id = '90000000-0000-4000-8000-000000000041'
  ),
  'cancelada',
  'saldo de dia anterior fica encerrado'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.confirm_romaneio_receipt('90000000-0000-4000-8000-000000000021', '[]'::jsonb) $$,
  '22023',
  'A conferencia precisa informar todos os itens do romaneio.',
  'conferencia vazia nao fecha romaneio'
);

reset role;

select is(
  (select status from public.romaneios where id = '90000000-0000-4000-8000-000000000021'),
  'enviado',
  'romaneio com conferencia vazia permanece enviado'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.confirm_romaneio_receipt(
    '90000000-0000-4000-8000-000000000022',
    '[{
      "id": "90000000-0000-4000-8000-000000000032",
      "qty_received": 5,
      "qty_accepted": 5,
      "divergence_reason": "",
      "obs": ""
    }]'::jsonb
  ) $$,
  '22023',
  'Confira todos os itens antes de fechar o romaneio.',
  'conferencia parcial nao fecha romaneio'
);

reset role;

select is(
  (select status from public.romaneios where id = '90000000-0000-4000-8000-000000000022'),
  'enviado',
  'romaneio com conferencia parcial permanece enviado'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$ select public.confirm_romaneio_receipt(
    '90000000-0000-4000-8000-000000000023',
    '[{
      "id": "90000000-0000-4000-8000-000000000034",
      "qty_received": 5,
      "qty_accepted": 5,
      "divergence_reason": "",
      "obs": ""
    }, {
      "id": "90000000-0000-4000-8000-000000000034",
      "qty_received": 5,
      "qty_accepted": 5,
      "divergence_reason": "",
      "obs": ""
    }]'::jsonb
  ) $$,
  '22023',
  'A conferencia nao pode repetir item do romaneio.',
  'conferencia com item repetido nao fecha romaneio'
);

select throws_ok(
  $$ select public.confirm_romaneio_receipt(
    '90000000-0000-4000-8000-000000000024',
    '[{
      "id": "90000000-0000-4000-8000-000000000036",
      "qty_received": 4,
      "qty_accepted": 5,
      "divergence_reason": "",
      "obs": ""
    }]'::jsonb
  ) $$,
  '22023',
  'Quantidade aceita nao pode ser maior que recebida.',
  'conferencia com aceito maior que recebido nao fecha romaneio'
);

select is(
  public.confirm_romaneio_receipt(
    '90000000-0000-4000-8000-000000000025',
    '[{
      "id": "90000000-0000-4000-8000-000000000037",
      "qty_received": 5,
      "qty_accepted": 5,
      "divergence_reason": "",
      "obs": ""
    }, {
      "id": "90000000-0000-4000-8000-000000000038",
      "qty_received": 6,
      "qty_accepted": 6,
      "divergence_reason": "",
      "obs": ""
    }]'::jsonb
  ),
  'conferido',
  'conferencia completa sem divergencia fecha romaneio'
);

select * from finish();
rollback;
