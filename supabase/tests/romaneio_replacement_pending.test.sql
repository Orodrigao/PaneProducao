-- Comportamento da fila de reposicao: a conferencia da EX cria uma pendencia
-- operacional para o proximo envio quando o aceito fica menor que o enviado.

begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

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
    92,
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
