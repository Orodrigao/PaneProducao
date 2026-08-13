begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select ok(exists(select 1 from public.finance_accounts where key = 'cartao_sicredi_jc' and label = 'Sicredi JC' and kind = 'cartao_credito'), 'Sicredi JC e cartao proprio');
select ok(exists(select 1 from public.finance_accounts where key = 'cartao_banrisul_jc' and label = 'Banrisul JC' and kind = 'cartao_credito'), 'Banrisul JC e cartao proprio');
select ok(exists(select 1 from public.finance_accounts where key = 'cartao_sicredi_sf' and label = 'Sicredi SF' and kind = 'cartao_credito'), 'Sicredi SF e cartao proprio');
select isnt((select id from public.finance_accounts where key = 'cartao_sicredi_jc'), (select id from public.finance_accounts where key = 'banco_sicredi_jc'), 'cartao Sicredi e banco Sicredi sao contas diferentes');
select ok(exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_entries' and column_name = 'card_invoice_id'), 'lancamento nasce pronto para vinculo futuro da fatura');
select ok(exists(select 1 from pg_trigger where tgname = 'finance_entries_account_payment_check'), 'livro valida forma e conta no banco');
select ok(exists(select 1 from pg_trigger where tgname = 'payable_installments_account_payment_check'), 'baixa valida forma e conta no banco');
select ok(exists(select 1 from pg_trigger where tgname = 'finance_transfers_card_block'), 'transferencia generica bloqueia cartao');
select ok(has_function_privilege('authenticated', 'public.create_and_pay_manual_payable(uuid, uuid, date, text, text, text, jsonb, jsonb, date, numeric, text, date, text, jsonb)', 'execute'), 'compra manual ja paga usa operacao protegida unica');

select * from finish();
rollback;
