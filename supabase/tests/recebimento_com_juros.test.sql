-- Recebimento acima do saldo: o que passa vira juros recebidos.
--
-- O que este teste protege:
--   * pagamento atrasado a mais abate só o saldo e separa o resto como juros;
--   * no livro, a venda pesa no mês do faturamento e os juros no mês do
--     recebimento, na categoria própria, com previsto zero;
--   * o dinheiro do livro continua sendo o que entrou no banco;
--   * pagamento a mais até o vencimento exige justificativa de verdade (espaço e
--     quebra de linha não contam), e ela vai para o pedaço e para a linha de juros;
--   * em pedaços, só o que passa do saldo vira juros, e o estorno respeita a
--     ordem: primeiro o pedaço que carrega os juros;
--   * a sobra NÃO vira juros no pedido PJ que ainda segue a conferência
--     (jornada antes da saída, ou valor corrigido depois de pagamento);
--   * cobrança já na categoria de juros sai numa linha só;
--   * perfil sem permissão não registra nem consulta a regra.

begin;
create extension if not exists pgtap with schema extensions;

select plan(54);

-- Cenário ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('a2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'financeiro-juros-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false),
  ('a2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'vendas-juros-test@example.com',
   '$2a$10$7EqJtq98hPqEX7fNZaFWoOhiECGBjbvfeY/eAPU59rtoPeDPZhvtW',
   now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false);

insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
values
  ('a2000000-0000-4000-8000-000000000001', 'Teste Financeiro Juros', 'financeiro', 'jc', true, '["/contas-receber"]'::jsonb),
  ('a2000000-0000-4000-8000-000000000002', 'Teste Vendas Juros', 'vendas', 'ja', true, '["/pedidos"]'::jsonb);

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
values
  ('a2000000-0000-4000-8000-000000000001', 'contas_receber.acessar', 'jc', null),
  ('a2000000-0000-4000-8000-000000000001', 'contas_receber.lancar', 'jc', null),
  ('a2000000-0000-4000-8000-000000000001', 'contas_receber.baixar', 'jc', null),
  ('a2000000-0000-4000-8000-000000000001', 'contas_receber.estornar', 'jc', null),
  ('a2000000-0000-4000-8000-000000000001', 'financeiro.acessar', '*', null);

insert into public.customers (id, name, doc, payment_term_days, active)
values ('a2000000-0000-4000-8000-0000000000c1', '[TESTE] Cliente Juros', '44555666000172', 10, true);

select is(
  (select nature || '|' || dre_group from public.finance_categories where key = 'juros_recebidos'),
  'receita|financeiras',
  'a categoria de juros recebidos existe como receita, no grupo das financeiras'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);

-- A: boleto pago com atraso e com juros ------------------------------------
-- Faturada há 40 dias, prazo de 10: venceu há 30. Pagou 523,07 há 5 dias.

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a001'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 500.00, 'Paes de agosto'
  ) $$,
  'financeiro lanca a cobranca de 500,00'
);

select is(
  public.receivable_excess_mode((select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid)),
  'juros',
  'cobranca avulsa: a sobra vira juros'
);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b001'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid),
    private.data_na_padaria() - 5, 523.07, 'boleto', 'banco_sicredi_jc'
  ) $$,
  'pagamento atrasado a mais nao pede justificativa'
);

select is((select amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid), 500.00,
  'o pedaco abate somente o saldo');

select is((select interest_amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid), 23.07,
  'o que passou do saldo fica guardado como juros');

select is((select status from public.receivables
    where request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid), 'recebida',
  'a cobranca fecha');

select is((select private.receivable_recebido(id) from public.receivables
    where request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid), 500.00,
  'o recebido da cobranca nao inclui os juros');

select is((select count(*)::int from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null
      and source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)), 2,
  'o pedaco vira duas linhas no livro');

select is((select entry.amount from public.finance_entries entry
    join public.receivables cobranca on cobranca.finance_category_id = entry.category_id
    where cobranca.request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid
      and entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)),
  500.00,
  'a venda fica na categoria da cobranca com o valor cobrado');

select is((select entry.competence_month from public.finance_entries entry
    join public.receivables cobranca on cobranca.finance_category_id = entry.category_id
    where cobranca.request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid
      and entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)),
  date_trunc('month', private.data_na_padaria() - 40)::date,
  'a venda pesa no mes do faturamento');

select is((select entry.amount from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id and category.key = 'juros_recebidos'
    where entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)),
  23.07,
  'os juros viram linha propria em juros recebidos');

select is((select entry.competence_month from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id and category.key = 'juros_recebidos'
    where entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)),
  date_trunc('month', private.data_na_padaria() - 5)::date,
  'os juros pesam no mes em que o dinheiro entrou');

select is((select entry.planned_amount from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id and category.key = 'juros_recebidos'
    where entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)),
  0::numeric,
  'ninguem planeja receber juros: previsto zero');

select is((select sum(amount) from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is null
      and source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)),
  523.07,
  'o livro soma exatamente o dinheiro que entrou');

select is(
  (select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b001'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a001'::uuid),
    private.data_na_padaria() - 5, 523.07, 'boleto', 'banco_sicredi_jc')),
  (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid),
  'repetir o mesmo recebimento devolve o mesmo pedaco'
);

select is((select count(*)::int from public.finance_entries
    where source = 'contas_receber' and reversed_at is null
      and source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b001'::uuid)), 2,
  'e nao duplica as linhas do livro');

-- B: pagamento a mais sem atraso -------------------------------------------
-- Faturada há 3 dias, vence daqui a 7. Pagou 310 numa cobrança de 300 hoje.

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a002'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 3, 300.00, 'Paes da semana'
  ) $$,
  'financeiro lanca a cobranca de 300,00 ainda a vencer'
);

select throws_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b002'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid),
    private.data_na_padaria(), 310.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  '22023',
  'O pagamento não está atrasado e passou R$ 10,00 do que falta. Confira o valor ou informe a justificativa.',
  'valor a mais sem atraso e sem justificativa e recusado'
);

select throws_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b010'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid),
    private.data_na_padaria(), 310.00, 'pix', 'banco_sicredi_jc', E' \n\t\r\n '
  ) $$,
  '22023',
  'O pagamento não está atrasado e passou R$ 10,00 do que falta. Confira o valor ou informe a justificativa.',
  'espaco, tabulacao e quebra de linha nao contam como justificativa'
);

select throws_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b003'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid),
    private.data_na_padaria(), 310.00, 'pix', 'banco_sicredi_jc', 'ok'
  ) $$,
  '22023',
  'Escreva a justificativa com pelo menos 3 letras.',
  'justificativa de duas letras e recusada'
);

select throws_ok(
  format($f$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b011'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid),
    private.data_na_padaria(), 310.00, 'pix', 'banco_sicredi_jc', %L
  ) $f$, repeat('x', 301)),
  '22023',
  'A justificativa passou de 300 caracteres. Resuma o motivo.',
  'justificativa acima de 300 caracteres e recusada'
);

select is((select count(*)::int from public.receivable_receipts
    where receivable_id = (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid)), 0,
  'as tentativas recusadas nao gravaram nada');

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b004'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a002'::uuid),
    private.data_na_padaria(), 310.00, 'pix', 'banco_sicredi_jc', E'  Cliente arredondou para cima\n'
  ) $$,
  'com justificativa, o valor a mais sem atraso e aceito'
);

select is((select excess_reason || '|' || interest_amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b004'::uuid),
  'Cliente arredondou para cima|10.00',
  'o pedaco guarda a justificativa limpa e os juros');

select matches((select entry.description from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id and category.key = 'juros_recebidos'
    where entry.source = 'contas_receber' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b004'::uuid)),
  'Cliente arredondou para cima$',
  'a linha de juros do livro mostra a justificativa');

-- B2: o dia do vencimento ainda não é atraso ------------------------------
-- Faturada há 10 dias com prazo de 10: vence hoje.

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a005'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 10, 200.00, 'Paes que vencem hoje'
  ) $$,
  'financeiro lanca a cobranca que vence hoje'
);

select throws_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b012'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a005'::uuid),
    private.data_na_padaria(), 205.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  '22023',
  'O pagamento não está atrasado e passou R$ 5,00 do que falta. Confira o valor ou informe a justificativa.',
  'pagar a mais no proprio dia do vencimento ainda pede justificativa'
);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b013'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a005'::uuid),
    private.data_na_padaria(), 150.00, 'pix', 'banco_sicredi_jc', 'Motivo sem valor a mais'
  ) $$,
  'recebimento parcial com texto de justificativa e aceito'
);

select is((select coalesce(excess_reason, 'sem motivo') || '|' || interest_amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b013'::uuid),
  'sem motivo|0.00',
  'sem valor a mais, o texto de justificativa e descartado');

-- C: pedaços e a ordem do estorno ------------------------------------------
-- Cobrança de 1.000, vencida. Pedaço de 600 e depois de 450: só 50 são juros.

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a003'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 1000.00, 'Paes de julho'
  ) $$,
  'financeiro lanca a cobranca de 1.000,00'
);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b005'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a003'::uuid),
    private.data_na_padaria() - 20, 600.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  'primeiro pedaco de 600'
);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b006'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a003'::uuid),
    private.data_na_padaria() - 10, 450.00, 'pix', 'banco_sicredi_jc',
    'Cliente pagou com juros do boleto'
  ) $$,
  'segundo pedaco de 450 passa do saldo; com atraso a justificativa e opcional'
);

select is((select amount || '|' || interest_amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b006'::uuid),
  '400.00|50.00',
  'so o que passa do saldo vira juros');

select throws_ok(
  $$ select public.reverse_receivable_receipt(
    'a2000000-0000-4000-8000-00000000e001'::uuid,
    (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b005'::uuid),
    'Pix devolvido'
  ) $$,
  '22023',
  'O recebimento de ' || to_char(private.data_na_padaria() - 10, 'DD/MM/YYYY')
    || ' separou R$ 50,00 de juros contando com este. Estorne aquele primeiro.',
  'nao estorna o pedaco anterior enquanto o posterior carrega juros'
);

select lives_ok(
  $$ select public.reverse_receivable_receipt(
    'a2000000-0000-4000-8000-00000000e002'::uuid,
    (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b006'::uuid),
    'Valor digitado errado'
  ) $$,
  'o pedaco com juros e estornado primeiro'
);

select is((select count(*)::int || '|' || sum(amount) from public.finance_entries
    where source = 'contas_receber' and entry_type = 'estorno'
      and source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b006'::uuid)),
  '2|450.00',
  'o estorno cria contra-lancamento da venda e dos juros');

select is((select count(*)::int from public.finance_entries
    where source = 'contas_receber' and entry_type = 'lancamento' and reversed_at is not null
      and source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b006'::uuid)),
  2,
  'as duas linhas originais ficam marcadas como estornadas');

select lives_ok(
  $$ select public.reverse_receivable_receipt(
    'a2000000-0000-4000-8000-00000000e003'::uuid,
    (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b005'::uuid),
    'Pix devolvido'
  ) $$,
  'depois disso o pedaco anterior pode ser estornado'
);

-- D: valor corrigido depois de pagamento -----------------------------------
-- A liberação da jornada PJ corrigiu o valor com dinheiro dentro: a sobra é
-- diferença de quantidade, que a ficha PJ trata por devolução ou crédito.

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a006'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 190.00, 'Pedido corrigido'
  ) $$,
  'financeiro lanca a cobranca corrigida'
);

reset role;
insert into public.receivable_events (receivable_id, event_type, reason, details, created_by)
select id, 'valor_corrigido_pj', 'Nova conferencia apos pagamento', '{"de":200,"para":190}'::jsonb,
       'a2000000-0000-4000-8000-000000000001'
from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a006'::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);

select is(
  public.receivable_excess_mode((select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a006'::uuid)),
  'valor_do_pedido',
  'cobranca com valor corrigido depois de pagamento: a sobra fica no pedido'
);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b014'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a006'::uuid),
    private.data_na_padaria() - 5, 200.00, 'boleto', 'banco_sicredi_jc', 'Texto que nao deve ficar'
  ) $$,
  'o resto do boleto original e registrado'
);

select is((select amount || '|' || interest_amount || '|' || coalesce(excess_reason, 'sem motivo') from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b014'::uuid),
  '200.00|0.00|sem motivo',
  'nada vira juros: o pedaco guarda tudo, como antes');

select is((select count(*)::int || '|' || sum(entry.amount) || '|' || min(category.key) from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id
    where entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b014'::uuid)),
  '1|200.00|clientes_pj',
  'o livro recebe uma linha so, na categoria da cobranca');

-- E: pedido PJ da jornada antes e depois da saída --------------------------

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a007'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 400.00, 'Pedido da jornada'
  ) $$,
  'financeiro lanca a cobranca que vira pedido da jornada'
);

-- A origem muda antes de o grupo existir na jornada: depois disso o gatilho
-- da jornada barra qualquer alteração fora da revisão do pedido.
reset role;
update public.receivables
set origin = 'pedido_pj', origin_ref = 'a2000000-0000-4000-8000-0000000000f1'
where request_id = 'a2000000-0000-4000-8000-00000000a007'::uuid;
insert into private.pj_flow (order_group_id) values ('a2000000-0000-4000-8000-0000000000f1');
-- A leitura da cobrança da jornada exige acesso comercial ao pedido PJ, que
-- este perfil de teste não tem; as funções do recebimento a enxergam por
-- dentro. O id é guardado aqui para o teste provar a regra, não a leitura.
select set_config('teste.cobranca_jornada',
  (select id::text from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a007'::uuid), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);

select is(
  public.receivable_excess_mode(current_setting('teste.cobranca_jornada')::uuid),
  'valor_do_pedido',
  'pedido da jornada antes da saida: nova conferencia ainda pode mudar o valor'
);

reset role;
update private.pj_flow
set released_version = version, released_at = now(), departed_at = now()
where order_group_id = 'a2000000-0000-4000-8000-0000000000f1';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);

select is(
  public.receivable_excess_mode(current_setting('teste.cobranca_jornada')::uuid),
  'juros',
  'depois da saida o valor nao muda mais: a sobra vira juros'
);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b015'::uuid,
    current_setting('teste.cobranca_jornada')::uuid,
    private.data_na_padaria() - 5, 412.00, 'boleto', 'banco_sicredi_jc'
  ) $$,
  'boleto atrasado do pedido que ja saiu e registrado com juros'
);

reset role;
select is((select amount || '|' || interest_amount from public.receivable_receipts
    where request_id = 'a2000000-0000-4000-8000-00000000b015'::uuid),
  '400.00|12.00',
  'o pedido que ja saiu separa os juros');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);

-- F: cobrança já na categoria de juros sai numa linha só -------------------

select lives_ok(
  $$ select public.create_manual_receivable(
    'a2000000-0000-4000-8000-00000000a008'::uuid,
    'a2000000-0000-4000-8000-0000000000c1'::uuid,
    private.data_na_padaria() - 40, 80.00, 'Juros cobrados a parte'
  ) $$,
  'financeiro lanca uma cobranca de juros'
);

reset role;
update public.receivables
set finance_category_id = (select id from public.finance_categories where key = 'juros_recebidos')
where request_id = 'a2000000-0000-4000-8000-00000000a008'::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b016'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a008'::uuid),
    private.data_na_padaria() - 5, 85.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  'pagamento atrasado a mais da cobranca de juros'
);

select is((select count(*)::int || '|' || sum(entry.amount) || '|' || min(category.key) from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id
    where entry.source = 'contas_receber' and entry.entry_type = 'lancamento' and entry.reversed_at is null
      and entry.source_ref = (select id from public.receivable_receipts where request_id = 'a2000000-0000-4000-8000-00000000b016'::uuid)),
  '1|85.00|juros_recebidos',
  'na mesma categoria, uma linha so com todo o dinheiro, sem colidir');

-- G: perfil sem permissão --------------------------------------------------

select set_config('request.jwt.claim.sub', 'a2000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$ select public.record_receivable_receipt(
    'a2000000-0000-4000-8000-00000000b007'::uuid,
    (select id from public.receivables where request_id = 'a2000000-0000-4000-8000-00000000a003'::uuid),
    private.data_na_padaria(), 1050.00, 'pix', 'banco_sicredi_jc'
  ) $$,
  '42501',
  'Sem permissão para registrar recebimentos.',
  'vendas nao registra recebimento'
);

select throws_ok(
  $$ select public.receivable_excess_mode('a2000000-0000-4000-8000-00000000a003'::uuid) $$,
  '42501',
  'Sem permissão para registrar recebimentos.',
  'vendas nao consulta a regra do valor a mais'
);

reset role;

select * from finish();
rollback;
