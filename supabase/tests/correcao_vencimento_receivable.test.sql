-- Correção de vencimento: o Financeiro pode antecipar até o dia do faturamento.
--
-- O caso real: cobrança da Buck faturada em 20/09/2026 calculou 05/10 pelo
-- prazo cadastrado, mas o combinado com o cliente era 28/09. Antes desta
-- frente o banco recusava qualquer data anterior ao vencimento calculado.
--
-- O que este teste protege:
--   * antecipar para uma data entre o faturamento e o vencimento calculado grava;
--   * o próprio dia do faturamento é o limite aceito;
--   * um dia antes do faturamento é recusado e não grava nada;
--   * o vencimento combinado (original_due_date) continua sendo memória do
--     acordo, e não é reescrito pela correção;
--   * motivo continua obrigatório;
--   * repetir o mesmo pedido não corrige de novo;
--   * a tabela continua barrando vencimento anterior ao faturamento, mesmo
--     para quem escrevesse nela por fora da função.

begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- Cenário ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('9b000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-vencimento-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values ('9b000000-0000-4000-8000-000000000001', 'Teste Financeiro Vencimento', 'financeiro', 'jc', true,
  '["/contas-receber"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('9b000000-0000-4000-8000-000000000001', 'contas_receber.acessar', 'jc', null),
  ('9b000000-0000-4000-8000-000000000001', 'contas_receber.lancar', 'jc', null),
  ('9b000000-0000-4000-8000-000000000001', 'contas_receber.corrigir_vencimento', 'jc', null);

-- Prazo de 15 dias corridos, igual ao da Buck no caso real.
insert into public.customers (id, name, doc, payment_term_days, active)
values ('9b000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Vencimento', '33444555000182', 15, true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '9b000000-0000-4000-8000-000000000001', true);

-- Faturada anteontem: o vencimento calculado cai daqui a 13 dias.
select lives_ok(
  $$ select public.create_manual_receivable(
    '9b000000-0000-4000-8000-00000000a001'::uuid,
    '9b000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 2, 1000.00, 'Paes da semana'
  ) $$,
  'financeiro lanca a cobranca'
);

select is((select due_date from public.receivables
    where request_id = '9b000000-0000-4000-8000-00000000a001'::uuid),
  private.data_na_padaria() + 13,
  'o vencimento nasce do prazo cadastrado no cliente'
);

-- Antecipar: o caso da Buck ------------------------------------------------

select lives_ok(
  $$ select public.correct_receivable_due_date(
    '9b000000-0000-4000-8000-00000000b001'::uuid,
    (select id from public.receivables where request_id = '9b000000-0000-4000-8000-00000000a001'::uuid),
    private.data_na_padaria() + 5, 'Cliente combinou pagar antes'
  ) $$,
  'antecipar o vencimento para antes do prazo calculado e aceito'
);

select is((select due_date from public.receivables
    where request_id = '9b000000-0000-4000-8000-00000000a001'::uuid),
  private.data_na_padaria() + 5,
  'o vencimento antecipado fica gravado'
);

select is((select original_due_date from public.receivables
    where request_id = '9b000000-0000-4000-8000-00000000a001'::uuid),
  private.data_na_padaria() + 13,
  'o prazo combinado continua registrado, a correcao nao o reescreve'
);

select is(
  (select (evento.details ->> 'para')::date from public.receivable_events evento
   where evento.details ->> 'request_id' = '9b000000-0000-4000-8000-00000000b001'),
  private.data_na_padaria() + 5,
  'a correcao vira evento com a data nova'
);

-- O limite aceito é o próprio dia do faturamento ---------------------------

select lives_ok(
  $$ select public.correct_receivable_due_date(
    '9b000000-0000-4000-8000-00000000b002'::uuid,
    (select id from public.receivables where request_id = '9b000000-0000-4000-8000-00000000a001'::uuid),
    private.data_na_padaria() - 2, 'Cliente pagou a vista no faturamento'
  ) $$,
  'vencimento no proprio dia do faturamento e aceito'
);

select is((select due_date from public.receivables
    where request_id = '9b000000-0000-4000-8000-00000000a001'::uuid),
  private.data_na_padaria() - 2,
  'o vencimento no dia do faturamento fica gravado'
);

-- Antes do faturamento continua trancado -----------------------------------

select throws_ok(
  $$ select public.correct_receivable_due_date(
    '9b000000-0000-4000-8000-00000000b003'::uuid,
    (select id from public.receivables where request_id = '9b000000-0000-4000-8000-00000000a001'::uuid),
    private.data_na_padaria() - 3, 'Tentativa de cobrar antes de faturar'
  ) $$,
  '22023',
  'O vencimento não pode ser anterior ao dia em que a cobrança foi faturada.',
  'vencimento antes do faturamento e recusado'
);

select is((select due_date from public.receivables
    where request_id = '9b000000-0000-4000-8000-00000000a001'::uuid),
  private.data_na_padaria() - 2,
  'a recusa nao mexeu no vencimento gravado'
);

-- Motivo continua obrigatório ----------------------------------------------

select throws_ok(
  $$ select public.correct_receivable_due_date(
    '9b000000-0000-4000-8000-00000000b004'::uuid,
    (select id from public.receivables where request_id = '9b000000-0000-4000-8000-00000000a001'::uuid),
    private.data_na_padaria() + 2, '  '
  ) $$,
  '22023',
  'Informe o motivo da correção.',
  'correcao sem motivo continua recusada'
);

-- Repetir o mesmo pedido não corrige de novo -------------------------------

select lives_ok(
  $$ select public.correct_receivable_due_date(
    '9b000000-0000-4000-8000-00000000b002'::uuid,
    (select id from public.receivables where request_id = '9b000000-0000-4000-8000-00000000a001'::uuid),
    private.data_na_padaria() + 9, 'Repeticao do mesmo pedido'
  ) $$,
  'repetir o mesmo pedido nao levanta erro'
);

select is((select due_date from public.receivables
    where request_id = '9b000000-0000-4000-8000-00000000a001'::uuid),
  private.data_na_padaria() - 2,
  'a repeticao nao grava a data nova'
);

select is(
  (select count(*)::int from public.receivable_events evento
   join public.receivables cobranca on cobranca.id = evento.receivable_id
   where cobranca.request_id = '9b000000-0000-4000-8000-00000000a001'::uuid
     and evento.event_type = 'vencimento_corrigido'),
  2,
  'ficaram dois eventos de correcao, um por pedido distinto aceito'
);

-- O piso continua na tabela, não só na função -------------------------------

reset role;

-- A regra "só empurrar para frente" saiu; a regra "nunca antes de faturar"
-- ficou. Como dono da tabela, sem RLS no caminho, quem prova isso é a
-- constraint, e não a permissão.
select throws_ok(
  $$ update public.receivables
     set due_date = invoice_date - 1
     where request_id = '9b000000-0000-4000-8000-00000000a001'::uuid $$,
  '23514',
  'new row for relation "receivables" violates check constraint "receivables_due_after_invoice"',
  'escrita direta com vencimento antes do faturamento continua barrada pela tabela'
);

select lives_ok(
  $$ update public.receivables
     set due_date = original_due_date - 1
     where request_id = '9b000000-0000-4000-8000-00000000a001'::uuid $$,
  'a tabela deixou de exigir que o vencimento nunca ande para tras'
);

select * from finish();
rollback;
