-- Comportamento da fila de reposicao: a conferencia da EX cria uma pendencia
-- operacional para o proximo envio quando o aceito fica menor que o enviado.

begin;
create extension if not exists pgtap with schema extensions;

select plan(3);

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
) values (
  '90000000-0000-4000-8000-000000000020',
  current_date,
  '20000000-0000-4000-8000-000000000003',
  1,
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
) values (
  '90000000-0000-4000-8000-000000000030',
  '90000000-0000-4000-8000-000000000020',
  'teste-baguete',
  'bread',
  '[TESTE] Baguete',
  10,
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

select * from finish();
rollback;
