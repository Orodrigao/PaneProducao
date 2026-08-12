-- Financeiro, fase 1: contas a pagar entra no livro.
--
-- Plano: docs/FINANCEIRO.md. Pagar um boleto passa a escrever sozinho no
-- livro-caixa, com categoria de DRE e no mês da compra — não no mês do
-- pagamento (decisão 6: a farinha de julho pesa em julho, mesmo paga em
-- agosto).
--
-- Princípios herdados da fase 0 que continuam valendo aqui:
--   * o lançamento é imutável — corrigir a baixa estorna e relança;
--   * a soma dos lançamentos gerados é sempre igual ao valor pago;
--   * quem cria é a ação protegida, nunca a pessoa.

begin;

-- ---------------------------------------------------------------------------
-- O livro passa a aceitar origem automática.
-- ---------------------------------------------------------------------------
alter table public.finance_entries
  drop constraint if exists finance_entries_source_check;

alter table public.finance_entries
  add constraint finance_entries_source_check
    check (source in ('avulso', 'contas_pagar'));

alter table public.finance_entries
  add column if not exists source_ref uuid;

comment on column public.finance_entries.source_ref is
  'Registro que originou o lançamento (na fase 1: a parcela paga em payable_installments).';

-- A conta de origem é obrigatória no lançamento avulso (a função valida), mas
-- desconhecida quando a baixa acontece sem escolher de onde saiu o dinheiro.
-- Preferimos registrar "não informada" a inventar uma conta.
alter table public.finance_entries
  alter column account_id drop not null;

-- Um lançamento ativo por origem e categoria. O estorno tira a linha do índice
-- e libera o lugar para o lançamento corrigido — é o que permite recalcular
-- uma baixa sem apagar história.
create unique index if not exists finance_entries_origem_ativa_idx
  on public.finance_entries (source, source_ref, category_id)
  where source_ref is not null and entry_type = 'lancamento' and reversed_at is null;

create index if not exists finance_entries_source_ref_idx
  on public.finance_entries (source_ref)
  where source_ref is not null;

-- Gaveta obrigatória para o que ainda não foi classificado. Melhor uma despesa
-- visível sem categoria do que uma despesa fora do DRE.
insert into public.finance_categories (key, label, dre_tier, dre_group, nature, team, sort_order)
values ('nao_classificado', 'Não classificado', 'operacional', 'outras', 'despesa', null, 380)
on conflict (key) do update set
  label = excluded.label,
  dre_tier = excluded.dre_tier,
  dre_group = excluded.dre_group,
  nature = excluded.nature,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Classificação financeira da compra.
-- ---------------------------------------------------------------------------
alter table public.payable_purchases
  add column if not exists finance_account_id uuid references public.finance_accounts(id);

comment on column public.payable_purchases.finance_account_id is
  'De qual conta ou caixa o pagamento desta compra sai. Opcional.';

-- O rateio vive na compra, não na parcela: a natureza do gasto é do que foi
-- comprado. Cada parcela paga distribui o valor proporcionalmente.
create table if not exists public.payable_purchase_categories (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.payable_purchases(id) on delete cascade,
  category_id uuid not null references public.finance_categories(id),
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (purchase_id, category_id)
);

create index if not exists payable_purchase_categories_purchase_idx
  on public.payable_purchase_categories (purchase_id);

revoke all on table public.payable_purchase_categories from anon, authenticated;

alter table public.payable_purchase_categories enable row level security;
alter table public.payable_purchase_categories force row level security;

create policy payable_purchase_categories_select_finance
on public.payable_purchase_categories for select to authenticated
using (private.current_user_can_payables('contas_pagar.acessar'));

grant select on public.payable_purchase_categories to authenticated;

-- ---------------------------------------------------------------------------
-- Repartição do valor pago entre as categorias da compra.
-- ---------------------------------------------------------------------------
-- Os nomes de saída não repetem nomes de coluna das tabelas consultadas: em
-- plpgsql, parâmetro de retorno e coluna com o mesmo nome viram referência
-- ambígua e a função quebra em tempo de execução.
create or replace function private.split_payable_amount(
  p_purchase_id uuid,
  p_amount numeric
)
returns table (fatia_category_id uuid, fatia_valor numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total numeric(12,2);
  v_has_split boolean;
begin
  select purchase.total_value into v_total
  from public.payable_purchases purchase
  where purchase.id = p_purchase_id;

  select exists (
    select 1 from public.payable_purchase_categories split
    where split.purchase_id = p_purchase_id
  ) into v_has_split;

  -- Sem rateio informado, tudo cai na gaveta visível de não classificado.
  if not v_has_split or v_total is null or v_total <= 0 then
    return query
      select category.id, round(p_amount, 2)
      from public.finance_categories category
      where category.key = 'nao_classificado';
    return;
  end if;

  -- Proporcional ao rateio, com o resto do arredondamento na maior fatia:
  -- a soma das partes precisa bater exatamente com o valor pago.
  return query
  with proporcional as (
    select split.category_id as cat_id,
           round(p_amount * split.amount / v_total, 2) as valor,
           split.amount as peso
    from public.payable_purchase_categories split
    where split.purchase_id = p_purchase_id
  ), positivas as (
    select * from proporcional where proporcional.valor > 0
  ), maior as (
    select positivas.cat_id
    from positivas
    order by positivas.peso desc, positivas.cat_id
    limit 1
  ), com_resto as (
    select positivas.cat_id,
           positivas.valor
             + case
                 when positivas.cat_id = (select maior.cat_id from maior)
                 then round(p_amount, 2) - (select sum(positivas2.valor) from positivas positivas2)
                 else 0
               end as valor
    from positivas
  )
  select com_resto.cat_id, com_resto.valor
  from com_resto
  where com_resto.valor > 0;
end;
$$;

revoke all on function private.split_payable_amount(uuid, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Geração dos lançamentos de uma parcela paga.
-- ---------------------------------------------------------------------------
create or replace function private.sync_payable_finance_entries(
  p_installment_id uuid,
  p_user_id uuid,
  p_motivo_correcao text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_competencia date;
  v_descricao text;
  v_fatia record;
  v_planejado numeric(12,2);
begin
  select installment.id,
         installment.purchase_id,
         installment.installment_number,
         installment.amount as valor_original,
         installment.paid_amount,
         installment.paid_date,
         installment.paid_method,
         coalesce(installment.current_due_date, installment.due_date) as vencimento,
         purchase.total_value,
         purchase.finance_account_id,
         coalesce(purchase.nfe_issued_at, purchase.purchase_date) as data_compra,
         purchase.nfe_number,
         supplier.name as fornecedor
    into v_row
  from public.payable_installments installment
  join public.payable_purchases purchase on purchase.id = installment.purchase_id
  left join public.suppliers supplier on supplier.id = purchase.supplier_id
  where installment.id = p_installment_id;

  if v_row.id is null or v_row.paid_amount is null or v_row.paid_date is null then
    return;
  end if;

  -- Correção: o lançamento antigo não é apagado nem alterado. Nasce o
  -- contra-lançamento e, em seguida, o lançamento novo.
  if p_motivo_correcao is not null then
    insert into public.finance_entries (
      request_id, entry_type, category_id, account_id, store, competence_month,
      due_date, planned_amount, paid_date, amount, payment_method, description,
      source, source_ref, reversal_of, reversal_reason, created_by
    )
    select gen_random_uuid(), 'estorno', anterior.category_id, anterior.account_id,
           anterior.store, anterior.competence_month, anterior.due_date,
           anterior.planned_amount, current_date, anterior.amount,
           anterior.payment_method, 'Estorno de: ' || anterior.description,
           anterior.source, anterior.source_ref, anterior.id, p_motivo_correcao,
           p_user_id
    from public.finance_entries anterior
    where anterior.source = 'contas_pagar'
      and anterior.source_ref = p_installment_id
      and anterior.entry_type = 'lancamento'
      and anterior.reversed_at is null;

    update public.finance_entries
    set reversed_at = now(),
        reversed_by = p_user_id,
        reversal_reason = p_motivo_correcao
    where source = 'contas_pagar'
      and source_ref = p_installment_id
      and entry_type = 'lancamento'
      and reversed_at is null;
  end if;

  -- Já existe lançamento ativo para esta parcela: nada a fazer (idempotência
  -- contra toque duplo e contra chamadas simultâneas).
  if exists (
    select 1 from public.finance_entries existente
    where existente.source = 'contas_pagar'
      and existente.source_ref = p_installment_id
      and existente.entry_type = 'lancamento'
      and existente.reversed_at is null
  ) then
    return;
  end if;

  v_competencia := date_trunc('month', v_row.data_compra)::date;
  v_descricao := coalesce(nullif(trim(v_row.fornecedor), ''), 'Fornecedor')
    || coalesce(' · NF ' || nullif(trim(v_row.nfe_number), ''), '')
    || case when v_row.installment_number > 1
            then ' · parcela ' || v_row.installment_number
            else '' end;

  for v_fatia in
    select * from private.split_payable_amount(v_row.purchase_id, v_row.paid_amount)
  loop
    -- Previsto e realizado convivem: a diferença entre eles é o juro ou a
    -- multa que a padaria pagou a mais.
    v_planejado := round(v_fatia.fatia_valor * v_row.valor_original / nullif(v_row.paid_amount, 0), 2);
    if v_planejado is null or v_planejado <= 0 then
      v_planejado := v_fatia.fatia_valor;
    end if;

    insert into public.finance_entries (
      request_id, entry_type, category_id, account_id, store, competence_month,
      due_date, planned_amount, paid_date, amount, payment_method, description,
      source, source_ref, created_by
    )
    values (
      gen_random_uuid(), 'lancamento', v_fatia.fatia_category_id, v_row.finance_account_id,
      'jc', v_competencia, v_row.vencimento, v_planejado, v_row.paid_date,
      v_fatia.fatia_valor,
      coalesce(v_row.paid_method, 'outro'), v_descricao,
      'contas_pagar', p_installment_id, p_user_id
    );
  end loop;
end;
$$;

revoke all on function private.sync_payable_finance_entries(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Classificar a compra (categoria e conta de origem).
-- ---------------------------------------------------------------------------
create or replace function public.set_payable_finance_classification(
  p_purchase_id uuid,
  p_account_key text,
  p_categories jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric(12,2);
  v_soma numeric(12,2) := 0;
  v_conta uuid;
  v_item record;
  v_quantidade integer;
begin
  if not private.current_user_can_payables('contas_pagar.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissão para classificar contas da JC.';
  end if;

  select purchase.total_value into v_total
  from public.payable_purchases purchase
  where purchase.id = p_purchase_id
  for update;
  if v_total is null then
    raise exception using errcode = 'P0002', message = 'Conta não encontrada.';
  end if;

  if p_account_key is not null then
    select account.id into v_conta
    from public.finance_accounts account
    where account.key = p_account_key and account.active;
    if v_conta is null then
      raise exception using errcode = '22023', message = 'Conta de origem inválida ou inativa.';
    end if;
  end if;

  if jsonb_typeof(coalesce(p_categories, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Rateio inválido.';
  end if;

  v_quantidade := jsonb_array_length(coalesce(p_categories, '[]'::jsonb));
  if v_quantidade > 3 then
    raise exception using errcode = '22023', message = 'No máximo três categorias por conta.';
  end if;

  delete from public.payable_purchase_categories where purchase_id = p_purchase_id;

  if v_quantidade > 0 then
    for v_item in
      select * from jsonb_to_recordset(p_categories) as item(category_key text, amount numeric)
    loop
      if nullif(trim(coalesce(v_item.category_key, '')), '') is null
         or v_item.amount is null or v_item.amount <= 0 then
        raise exception using errcode = '22023', message = 'Categoria ou valor do rateio inválido.';
      end if;
      insert into public.payable_purchase_categories (purchase_id, category_id, amount)
      select p_purchase_id, category.id, round(v_item.amount, 2)
      from public.finance_categories category
      where category.key = v_item.category_key
        and category.active
        and category.nature <> 'transferencia';
      if not found then
        raise exception using errcode = '22023', message = 'Categoria inválida ou inativa: ' || v_item.category_key;
      end if;
      v_soma := v_soma + round(v_item.amount, 2);
    end loop;

    -- A soma do rateio precisa fechar com a conta: é o que garante que os
    -- lançamentos gerados somem exatamente o valor pago.
    if round(v_soma, 2) <> round(v_total, 2) then
      raise exception using errcode = '22023',
        message = 'A soma do rateio precisa ser igual ao total da conta.';
    end if;
  end if;

  update public.payable_purchases
  set finance_account_id = v_conta, updated_at = now()
  where id = p_purchase_id;

  insert into public.payable_events (purchase_id, event_type, details, occurred_by)
  values (
    p_purchase_id,
    'corrigida',
    jsonb_build_object('classificacao_financeira', coalesce(p_categories, '[]'::jsonb), 'conta', p_account_key),
    (select auth.uid())
  );
end;
$$;

revoke all on function public.set_payable_finance_classification(uuid, text, jsonb) from public, anon;
grant execute on function public.set_payable_finance_classification(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- A baixa e a correção passam a alimentar o livro.
-- ---------------------------------------------------------------------------
create or replace function public.record_payable_installment_payment(
  p_installment_id uuid,
  p_paid_date date,
  p_paid_amount numeric,
  p_paid_method text,
  p_current_due_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_installment record;
  v_user_id uuid := (select auth.uid());
begin
  if not private.current_user_can_payables('contas_pagar.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissão para baixar contas da JC.';
  end if;

  select installment.id, installment.purchase_id, installment.amount, installment.due_date,
         installment.status as installment_status, purchase.status as purchase_status,
         purchase.purchase_date
    into v_installment
  from public.payable_installments installment
  join public.payable_purchases purchase on purchase.id = installment.purchase_id
  where installment.id = p_installment_id
  for update of installment, purchase;

  if v_installment.id is null then
    raise exception using errcode = 'P0002', message = 'Parcela não encontrada.';
  end if;
  if v_installment.purchase_status = 'cancelada' or v_installment.installment_status = 'cancelada' then
    raise exception using errcode = '22023', message = 'Conta cancelada não pode ser baixada.';
  end if;
  if v_installment.installment_status = 'paga' then
    raise exception using errcode = '22023', message = 'Parcela já paga. Use a correção da baixa.';
  end if;
  if p_paid_date is null or p_paid_date > current_date or p_paid_date < v_installment.purchase_date then
    raise exception using errcode = '22023', message = 'A data do pagamento precisa estar entre a compra e hoje.';
  end if;
  if p_paid_amount is null or p_paid_amount < v_installment.amount then
    raise exception using errcode = '22023', message = 'O valor pago não pode ser menor que o valor original da parcela.';
  end if;
  if p_paid_method not in ('dinheiro', 'pix', 'transferencia', 'boleto') then
    raise exception using errcode = '22023', message = 'Forma real de pagamento inválida.';
  end if;
  if p_current_due_date is not null and p_current_due_date < v_installment.due_date then
    raise exception using errcode = '22023', message = 'O vencimento atualizado não pode ser anterior ao vencimento original.';
  end if;

  update public.payable_installments
  set status = 'paga',
      paid_date = p_paid_date,
      paid_amount = round(p_paid_amount, 2),
      paid_method = p_paid_method,
      current_due_date = p_current_due_date,
      paid_at = now(),
      paid_by = v_user_id
  where id = p_installment_id;

  update public.payable_purchases purchase
  set status = case when not exists (
        select 1 from public.payable_installments installment
        where installment.purchase_id = v_installment.purchase_id and installment.status = 'pendente'
      ) then 'paga' else 'aberta' end,
      paid_at = case when not exists (
        select 1 from public.payable_installments installment
        where installment.purchase_id = v_installment.purchase_id and installment.status = 'pendente'
      ) then now() else null end,
      paid_by = case when not exists (
        select 1 from public.payable_installments installment
        where installment.purchase_id = v_installment.purchase_id and installment.status = 'pendente'
      ) then v_user_id else null end,
      updated_at = now()
  where purchase.id = v_installment.purchase_id;

  insert into public.payable_events (purchase_id, event_type, details, occurred_by)
  values (
    v_installment.purchase_id,
    'baixada',
    jsonb_build_object(
      'installment_id', p_installment_id,
      'paid_date', p_paid_date,
      'paid_amount', round(p_paid_amount, 2),
      'paid_method', p_paid_method,
      'current_due_date', p_current_due_date
    ),
    v_user_id
  );

  -- O livro é alimentado pela mesma transação da baixa: ou as duas coisas
  -- acontecem, ou nenhuma.
  perform private.sync_payable_finance_entries(p_installment_id, v_user_id, null);
end;
$$;

create or replace function public.correct_payable_installment_payment(
  p_installment_id uuid,
  p_paid_date date,
  p_paid_amount numeric,
  p_paid_method text,
  p_current_due_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_installment record;
  v_user_id uuid := (select auth.uid());
begin
  if not private.current_user_can_payables('contas_pagar.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissão para corrigir baixas da JC.';
  end if;

  select installment.id, installment.purchase_id, installment.amount, installment.due_date,
         installment.status as installment_status, installment.paid_date as old_paid_date,
         installment.paid_amount as old_paid_amount, installment.paid_method as old_paid_method,
         installment.current_due_date as old_current_due_date, purchase.status as purchase_status,
         purchase.purchase_date
    into v_installment
  from public.payable_installments installment
  join public.payable_purchases purchase on purchase.id = installment.purchase_id
  where installment.id = p_installment_id
  for update of installment, purchase;

  if v_installment.id is null then
    raise exception using errcode = 'P0002', message = 'Parcela não encontrada.';
  end if;
  if v_installment.purchase_status = 'cancelada' or v_installment.installment_status = 'cancelada' then
    raise exception using errcode = '22023', message = 'Conta cancelada não pode ser corrigida.';
  end if;
  if v_installment.installment_status <> 'paga' then
    raise exception using errcode = '22023', message = 'Somente uma parcela paga pode ter a baixa corrigida.';
  end if;
  if p_paid_date is null or p_paid_date > current_date or p_paid_date < v_installment.purchase_date then
    raise exception using errcode = '22023', message = 'A data do pagamento precisa estar entre a compra e hoje.';
  end if;
  if p_paid_amount is null or p_paid_amount < v_installment.amount then
    raise exception using errcode = '22023', message = 'O valor pago não pode ser menor que o valor original da parcela.';
  end if;
  if p_paid_method not in ('dinheiro', 'pix', 'transferencia', 'boleto') then
    raise exception using errcode = '22023', message = 'Forma real de pagamento inválida.';
  end if;
  if p_current_due_date is not null and p_current_due_date < v_installment.due_date then
    raise exception using errcode = '22023', message = 'O vencimento atualizado não pode ser anterior ao vencimento original.';
  end if;

  update public.payable_installments
  set paid_date = p_paid_date,
      paid_amount = round(p_paid_amount, 2),
      paid_method = p_paid_method,
      current_due_date = p_current_due_date,
      paid_at = now(),
      paid_by = v_user_id
  where id = p_installment_id;

  update public.payable_purchases
  set updated_at = now(), paid_by = v_user_id
  where id = v_installment.purchase_id;

  insert into public.payable_events (purchase_id, event_type, details, occurred_by)
  values (
    v_installment.purchase_id,
    'corrigida',
    jsonb_build_object(
      'installment_id', p_installment_id,
      'old_paid_date', v_installment.old_paid_date,
      'old_paid_amount', v_installment.old_paid_amount,
      'old_paid_method', v_installment.old_paid_method,
      'old_current_due_date', v_installment.old_current_due_date,
      'paid_date', p_paid_date,
      'paid_amount', round(p_paid_amount, 2),
      'paid_method', p_paid_method,
      'current_due_date', p_current_due_date
    ),
    v_user_id
  );

  perform private.sync_payable_finance_entries(
    p_installment_id, v_user_id, 'Correção da baixa da conta a pagar'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reclassificar uma conta já paga: estorna e relança na categoria certa.
-- ---------------------------------------------------------------------------
create or replace function public.reclassify_payable_finance_entries(
  p_purchase_id uuid,
  p_account_key text,
  p_categories jsonb,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_installment_id uuid;
  v_total integer := 0;
begin
  if not private.current_user_can_finance('financeiro.lancar')
     or not private.current_user_can_finance('financeiro.estornar') then
    raise exception using errcode = '42501', message = 'Sem permissão para reclassificar lançamentos.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null or length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'Informe o motivo da reclassificação.';
  end if;

  perform public.set_payable_finance_classification(p_purchase_id, p_account_key, p_categories);

  for v_installment_id in
    select installment.id
    from public.payable_installments installment
    where installment.purchase_id = p_purchase_id
      and installment.status = 'paga'
    order by installment.installment_number
  loop
    perform private.sync_payable_finance_entries(
      v_installment_id, (select auth.uid()), trim(p_reason)
    );
    v_total := v_total + 1;
  end loop;

  return v_total;
end;
$$;

revoke all on function public.reclassify_payable_finance_entries(uuid, text, jsonb, text) from public, anon;
grant execute on function public.reclassify_payable_finance_entries(uuid, text, jsonb, text) to authenticated;

revoke all on function public.record_payable_installment_payment(uuid, date, numeric, text, date) from public, anon;
revoke all on function public.correct_payable_installment_payment(uuid, date, numeric, text, date) from public, anon;
grant execute on function public.record_payable_installment_payment(uuid, date, numeric, text, date) to authenticated;
grant execute on function public.correct_payable_installment_payment(uuid, date, numeric, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: as contas já pagas entram no livro como não classificadas.
-- Sem isto, o DRE começa cego para a despesa que já existe.
-- ---------------------------------------------------------------------------
do $$
declare
  v_installment record;
  v_autor uuid;
begin
  for v_installment in
    select installment.id, coalesce(installment.paid_by, purchase.created_by) as autor
    from public.payable_installments installment
    join public.payable_purchases purchase on purchase.id = installment.purchase_id
    where installment.status = 'paga'
      and installment.paid_amount is not null
      and installment.paid_date is not null
      and not exists (
        select 1 from public.finance_entries entry
        where entry.source = 'contas_pagar' and entry.source_ref = installment.id
      )
    order by installment.paid_date
  loop
    v_autor := v_installment.autor;
    if v_autor is null then
      continue;
    end if;
    perform private.sync_payable_finance_entries(v_installment.id, v_autor, null);
  end loop;
end;
$$;

commit;
