-- Juros e multa de boleto param de virar CMV.
--
-- Até aqui, a parcela paga acima do valor de face lançava o valor CHEIO nas
-- categorias de rateio da compra: o juro de um boleto de farinha entrava como
-- "CMV — Matéria-prima" e inflava o custo do insumo. A tela da baixa já dizia
-- "acréscimo registrado como juros/multa", mas o livro não cumpria a promessa.
--
-- A partir daqui a parcela paga com acréscimo gera duas linhas no livro:
--   * o principal, nas categorias da compra, na competência da compra;
--   * o acréscimo, em 'financeiras', na competência do PAGAMENTO — juro não é
--     custo da mercadoria, é despesa causada pelo atraso. Jogá-lo na
--     competência da compra mudaria retroativamente um mês que o Rodrigo já
--     fechou e olhou (mesma armadilha da lição 2026-08-13).
--
-- O que sai do caixa não muda: a soma das linhas continua sendo o valor pago.
-- A Elis também não digita nada novo — o acréscimo é deduzido da diferença
-- entre o valor de face da parcela e o valor pago, que o banco já guarda.
--
-- Fora do escopo, por decisão consciente: pagar MENOS que o valor de face
-- segue recusado. Aceitar valor menor sem exigir o motivo (desconto comercial,
-- abatimento negociado ou pagamento parcial) esconderia dinheiro e sujaria o
-- CMV pelo outro lado. Vira fase própria quando houver caso real.

-- ---------------------------------------------------------------------------
-- 1. Previsto zero passa a ser válido.
-- ---------------------------------------------------------------------------
-- Ninguém planeja pagar juro: o previsto dele é zero, e o realizado é o que
-- doeu. Com isso a diferença previsto/realizado que a tela já calcula mostra
-- sozinha que aquilo não estava no orçamento. A trava continua barrando
-- valor negativo.
alter table public.finance_entries
  drop constraint if exists finance_entries_planned_amount_check;

alter table public.finance_entries
  add constraint finance_entries_planned_amount_check
  check (planned_amount >= 0);

-- ---------------------------------------------------------------------------
-- 2. A geração dos lançamentos da parcela paga.
-- ---------------------------------------------------------------------------
-- Redefinição integral a partir da versão vigente (migration
-- 20260812151549), preservando o ciclo de estorno e a trava de idempotência.
-- Mudanças em relação a ela:
--   a) o rateio passa a dividir o VALOR DE FACE da parcela, não o valor pago;
--   b) o acréscimo vira uma linha própria em 'financeiras';
--   c) as linhas nascem consolidadas por categoria antes do insert, para não
--      esbarrar no índice único (source, source_ref, category_id) quando a
--      própria compra já for classificada como despesa financeira;
--   d) a data do contra-lançamento do estorno passa a ser a data da padaria
--      (America/Sao_Paulo) em vez de current_date, que responde pelo fuso do
--      servidor e vira o dia às 21h (lição 2026-08-14).
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
  v_competencia_compra date;
  v_competencia_juros date;
  v_descricao text;
  v_descricao_juros text;
  v_linha record;
  v_juros numeric(12,2);
  v_categoria_financeiras uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
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
  -- contra-lançamento e, em seguida, o lançamento novo. O filtro não olha a
  -- categoria, então o estorno alcança também a linha de juros.
  if p_motivo_correcao is not null then
    insert into public.finance_entries (
      request_id, entry_type, category_id, account_id, store, competence_month,
      due_date, planned_amount, paid_date, amount, payment_method, description,
      source, source_ref, reversal_of, reversal_reason, created_by
    )
    select gen_random_uuid(), 'estorno', anterior.category_id, anterior.account_id,
           anterior.store, anterior.competence_month, anterior.due_date,
           anterior.planned_amount, v_hoje, anterior.amount,
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

  v_competencia_compra := date_trunc('month', v_row.data_compra)::date;
  v_competencia_juros := date_trunc('month', v_row.paid_date)::date;
  v_descricao := coalesce(nullif(trim(v_row.fornecedor), ''), 'Fornecedor')
    || coalesce(' · NF ' || nullif(trim(v_row.nfe_number), ''), '')
    || case when v_row.installment_number > 1
            then ' · parcela ' || v_row.installment_number
            else '' end;
  v_descricao_juros := 'Juros/multa · ' || v_descricao;

  -- O acréscimo é o que passou do valor de face. Pagar menos continua barrado
  -- nas RPCs de baixa e correção, então isto nunca é negativo.
  v_juros := greatest(round(v_row.paid_amount - v_row.valor_original, 2), 0);

  select category.id into v_categoria_financeiras
  from public.finance_categories category
  where category.key = 'financeiras';

  -- Sem a categoria no catálogo não há onde separar: o acréscimo volta a
  -- seguir junto com o principal, em vez de o pagamento ficar sem lançamento.
  if v_categoria_financeiras is null then
    v_juros := 0;
  end if;

  -- As linhas nascem consolidadas por categoria: uma linha por categoria,
  -- sempre, para não colidir com o índice único de lançamento ativo quando a
  -- compra já estiver classificada em 'financeiras'.
  for v_linha in
    with principal as (
      select fatia.fatia_category_id as category_id,
             fatia.fatia_valor       as valor,
             fatia.fatia_valor       as previsto,
             true                    as e_principal
      from private.split_payable_amount(v_row.purchase_id, v_row.valor_original) fatia
    ),
    acrescimo as (
      select v_categoria_financeiras as category_id,
             v_juros                 as valor,
             0::numeric              as previsto,
             false                   as e_principal
      where v_juros > 0
    ),
    todas as (
      select * from principal
      union all
      select * from acrescimo
    )
    select todas.category_id,
           round(sum(todas.valor), 2)     as valor,
           round(sum(todas.previsto), 2)  as previsto,
           -- Uma linha por categoria, sempre: se a compra já é classificada
           -- como financeira, principal e acréscimo somam na mesma linha e o
           -- juro continua legível pela diferença previsto/realizado.
           bool_or(todas.e_principal)     as tem_principal
    from todas
    group by todas.category_id
    having round(sum(todas.valor), 2) > 0
  loop
    insert into public.finance_entries (
      request_id, entry_type, category_id, account_id, store, competence_month,
      due_date, planned_amount, paid_date, amount, payment_method, description,
      source, source_ref, created_by
    )
    values (
      gen_random_uuid(), 'lancamento', v_linha.category_id, v_row.finance_account_id,
      'jc',
      -- Linha que carrega principal pesa no mês da compra; linha que é só
      -- acréscimo pesa no mês do pagamento.
      case when v_linha.tem_principal then v_competencia_compra else v_competencia_juros end,
      v_row.vencimento, v_linha.previsto, v_row.paid_date,
      v_linha.valor,
      coalesce(v_row.paid_method, 'outro'),
      case when v_linha.tem_principal then v_descricao else v_descricao_juros end,
      'contas_pagar', p_installment_id, p_user_id
    );
  end loop;
end;
$$;

revoke all on function private.sync_payable_finance_entries(uuid, uuid, text) from public, anon, authenticated;
