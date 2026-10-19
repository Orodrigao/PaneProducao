-- Trocar a categoria de uma conta a pagar relança no livro TODAS as parcelas
-- já pagas (19/10/2026).
--
-- A categoria de DRE é do que foi comprado, não do pagamento: o rateio vive na
-- compra (payable_purchase_categories) e cada parcela paga reparte o valor de
-- face entre as categorias. Até aqui, trocar o rateio ao corrigir a baixa de uma
-- parcela (correct_payable_payment_and_classification) ou ao baixar a próxima
-- (a tela chamava set_payable_finance_classification e depois a baixa) só
-- relançava a parcela daquele clique. As outras parcelas já pagas ficavam no
-- livro na categoria antiga e o DRE deixava de bater com o rateio da conta.
-- Medição em produção em 19/10/2026: 30 contas com duas ou mais parcelas pagas,
-- nenhuma ainda divergente; não há dado a corrigir.
--
-- O banco de onde o dinheiro saiu é de cada parcela. A compra guarda só a última
-- conta escolhida (finance_account_id, sobrescrita a cada baixa), mas o livro
-- guarda a conta de cada parcela no dia em que foi paga, e em produção há contas
-- com parcelas pagas por bancos diferentes. Reclassificar a categoria nunca
-- muda o banco de uma parcela já paga, nem quando ele estava "não informado".
--
-- Mudanças, todas partindo das versões vigentes em produção (conferidas por
-- pg_get_functiondef em 19/10/2026):
--   1. private.sync_payable_finance_entries (20260819202105) ganha
--      p_manter_conta: no relançamento, as linhas novas herdam a conta das
--      linhas ativas que estão sendo estornadas. Sem esse parâmetro, nada muda.
--   2. private.apply_payable_finance_classification: o corpo de
--      set_payable_finance_classification (20260812151549), sem a checagem de
--      permissão, mais o relançamento das parcelas pagas quando o rateio muda.
--      Rateio igual (a tela reenvia o mesmo a cada baixa) não estorna nada.
--   3. set_payable_finance_classification passa a delegar para a função 2.
--   4. correct_payable_payment_and_classification (20260812185601) delega para a
--      função 2 pulando a parcela corrigida, que é estornada e relançada logo
--      depois, com os valores novos e o banco escolhido.
--   5. public.record_payable_payment_and_classification: a baixa com
--      classificação numa transação só. Antes eram duas chamadas da tela; com o
--      relançamento, uma baixa recusada depois da reclassificação deixaria a
--      categoria trocada sem o pagamento.
--   6. reclassify_payable_finance_entries (20260812151549, sem tela) delega para
--      a função 2: continua relançando todas as parcelas pagas, mas agora
--      preserva o banco de cada uma.
--
-- Permissão: contas_pagar.baixar já estornava e relançava a parcela corrigida
-- (correct_payable_installment_payment). Relançar as outras parcelas pagas da
-- MESMA conta quando a categoria dela muda é a consequência dessa mesma
-- operação, por isso não exige financeiro.estornar. A reclassificação avulsa
-- continua exigindo financeiro.lancar e financeiro.estornar.
--
-- Limite que continua valendo (regra de 19/08/2026): conta classificada em
-- Financeiras junta principal e juros numa linha só, no mês da compra.

begin;

-- ---------------------------------------------------------------------------
-- 1. Geração dos lançamentos de uma parcela paga.
-- ---------------------------------------------------------------------------
-- A assinatura muda (parâmetro novo com padrão). As chamadas plpgsql existentes,
-- com três argumentos, seguem resolvendo para esta função.
drop function private.sync_payable_finance_entries(uuid, uuid, text);

create function private.sync_payable_finance_entries(
  p_installment_id uuid,
  p_user_id uuid,
  p_motivo_correcao text default null,
  p_manter_conta boolean default false
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
  v_conta uuid;
  v_contas_anteriores integer;
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

  v_conta := v_row.finance_account_id;

  -- Relançamento por troca de categoria: o dinheiro já saiu, e saiu de um
  -- banco só. As linhas novas herdam a conta das ativas, inclusive quando ela
  -- é "não informada" (nula). Só sem linha ativa a conta da compra é usada.
  if p_manter_conta then
    select count(distinct coalesce(anterior.account_id::text, '')),
           min(anterior.account_id::text)::uuid
      into v_contas_anteriores, v_conta
    from public.finance_entries anterior
    where anterior.source = 'contas_pagar'
      and anterior.source_ref = p_installment_id
      and anterior.entry_type = 'lancamento'
      and anterior.reversed_at is null;

    if v_contas_anteriores > 1 then
      raise exception using errcode = '22023',
        message = 'A parcela ' || v_row.installment_number
          || ' aparece no livro com mais de um banco. Corrija a baixa dessa parcela antes de trocar a categoria.';
    end if;
    if v_contas_anteriores = 0 then
      v_conta := v_row.finance_account_id;
    end if;
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
      gen_random_uuid(), 'lancamento', v_linha.category_id, v_conta,
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

revoke all on function private.sync_payable_finance_entries(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Gravar a classificação e manter o livro de acordo com ela.
-- ---------------------------------------------------------------------------
-- p_parcela_fora: a parcela que o próprio chamador estorna e relança logo em
-- seguida (correção) ou que ainda vai ser paga (baixa). Ela fica fora daqui para
-- não ganhar dois ciclos de estorno no mesmo clique.
-- p_relancar_sempre: relança mesmo com o rateio igual (reclassificação avulsa,
-- que existe para acertar o livro de uma conta paga).
create or replace function private.apply_payable_finance_classification(
  p_purchase_id uuid,
  p_account_key text,
  p_categories jsonb,
  p_motivo text,
  p_parcela_fora uuid,
  p_relancar_sempre boolean
)
returns integer
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
  v_rateio_antes jsonb;
  v_rateio_depois jsonb;
  v_motivo text := coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'Reclassificação da conta a pagar');
  v_parcela record;
  v_relancadas jsonb := '[]'::jsonb;
  v_user_id uuid := (select auth.uid());
begin
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

  -- Fotografia do rateio salvo, com a categoria pela chave e o valor em
  -- centavos: a mesma divisão enviada em outra ordem ou como 1000 e 1000.00 é
  -- o mesmo rateio.
  select coalesce(jsonb_agg(jsonb_build_object('category_key', category.key, 'amount', split.amount)
                            order by category.key), '[]'::jsonb)
    into v_rateio_antes
  from public.payable_purchase_categories split
  join public.finance_categories category on category.id = split.category_id
  where split.purchase_id = p_purchase_id;

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

  select coalesce(jsonb_agg(jsonb_build_object('category_key', category.key, 'amount', split.amount)
                            order by category.key), '[]'::jsonb)
    into v_rateio_depois
  from public.payable_purchase_categories split
  join public.finance_categories category on category.id = split.category_id
  where split.purchase_id = p_purchase_id;

  -- A conta da compra é a sugestão para a próxima baixa. O banco de cada
  -- parcela já paga fica no livro e não muda aqui.
  update public.payable_purchases
  set finance_account_id = v_conta, updated_at = now()
  where id = p_purchase_id;

  -- A compra está travada desde o início: baixas e correções desta conta
  -- esperam este relançamento terminar.
  if p_relancar_sempre or v_rateio_antes is distinct from v_rateio_depois then
    for v_parcela in
      select installment.id, installment.installment_number
      from public.payable_installments installment
      where installment.purchase_id = p_purchase_id
        and installment.status = 'paga'
        and installment.id is distinct from p_parcela_fora
      order by installment.installment_number
    loop
      perform private.sync_payable_finance_entries(v_parcela.id, v_user_id, v_motivo, true);
      v_relancadas := v_relancadas || jsonb_build_object(
        'installment_id', v_parcela.id,
        'installment_number', v_parcela.installment_number
      );
    end loop;
  end if;

  insert into public.payable_events (purchase_id, event_type, details, occurred_by)
  values (
    p_purchase_id,
    'corrigida',
    jsonb_build_object(
      'classificacao_financeira', coalesce(p_categories, '[]'::jsonb),
      'conta', p_account_key,
      'rateio_anterior', v_rateio_antes,
      'parcelas_relancadas', v_relancadas
    ),
    v_user_id
  );

  return jsonb_array_length(v_relancadas);
end;
$$;

revoke all on function private.apply_payable_finance_classification(uuid, text, jsonb, text, uuid, boolean)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Classificar a compra (categoria e conta de origem).
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
begin
  if not private.current_user_can_payables('contas_pagar.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissão para classificar contas da JC.';
  end if;

  perform private.apply_payable_finance_classification(
    p_purchase_id, p_account_key, p_categories,
    'Categoria da conta trocada: parcela já paga relançada na categoria nova',
    null, false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Corrigir a baixa trocando forma, conta e categoria numa transação só.
-- ---------------------------------------------------------------------------
create or replace function public.correct_payable_payment_and_classification(
  p_installment_id uuid, p_paid_date date, p_paid_amount numeric, p_paid_method text,
  p_current_due_date date, p_account_key text, p_categories jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare v_purchase_id uuid; v_account_id uuid;
begin
  if not private.current_user_can_payables('contas_pagar.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissao para corrigir baixas da JC.';
  end if;
  select purchase_id into v_purchase_id from public.payable_installments where id = p_installment_id for update;
  if v_purchase_id is null then raise exception using errcode = 'P0002', message = 'Parcela nao encontrada.'; end if;
  select id into v_account_id from public.finance_accounts where key = p_account_key and active;
  if v_account_id is null then raise exception using errcode = '22023', message = 'Conta de origem invalida ou inativa.'; end if;
  perform private.assert_finance_account_payment_match(v_account_id, p_paid_method);
  perform set_config('app.allow_payable_account_payment_change', 'on', true);
  -- As outras parcelas pagas seguem a categoria nova; a corrigida fica para a
  -- linha seguinte, que a estorna e relança com os valores e o banco novos.
  perform private.apply_payable_finance_classification(
    v_purchase_id, p_account_key, p_categories,
    'Categoria da conta trocada na correção da baixa de outra parcela',
    p_installment_id, false
  );
  perform public.correct_payable_installment_payment(p_installment_id, p_paid_date, p_paid_amount, p_paid_method, p_current_due_date);
  perform set_config('app.allow_payable_account_payment_change', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Baixar trocando conta e categoria numa transação só.
-- ---------------------------------------------------------------------------
-- Mesma ordem de travas da correção (parcela, depois compra). Sem a liberação
-- de conta x forma: como na baixa em duas chamadas, a conta escolhida precisa
-- combinar com a forma de todas as parcelas já pagas.
create or replace function public.record_payable_payment_and_classification(
  p_installment_id uuid, p_paid_date date, p_paid_amount numeric, p_paid_method text,
  p_current_due_date date, p_account_key text, p_categories jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare v_purchase_id uuid;
begin
  if not private.current_user_can_payables('contas_pagar.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissão para baixar contas da JC.';
  end if;
  select purchase_id into v_purchase_id from public.payable_installments where id = p_installment_id for update;
  if v_purchase_id is null then
    raise exception using errcode = 'P0002', message = 'Parcela não encontrada.';
  end if;
  perform private.apply_payable_finance_classification(
    v_purchase_id, p_account_key, p_categories,
    'Categoria da conta trocada na baixa de outra parcela',
    p_installment_id, false
  );
  perform public.record_payable_installment_payment(
    p_installment_id, p_paid_date, p_paid_amount, p_paid_method, p_current_due_date
  );
end;
$$;

revoke all on function public.record_payable_payment_and_classification(uuid, date, numeric, text, date, text, jsonb)
  from public, anon, service_role;
grant execute on function public.record_payable_payment_and_classification(uuid, date, numeric, text, date, text, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Reclassificar uma conta já paga: estorna e relança na categoria certa.
-- ---------------------------------------------------------------------------
-- Continua relançando todas as parcelas pagas, mesmo com o rateio igual. Muda
-- uma coisa: cada parcela fica no banco de onde saiu, em vez de ir para a conta
-- informada aqui, que passa a ser só a sugestão da próxima baixa.
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
begin
  if not private.current_user_can_finance('financeiro.lancar')
     or not private.current_user_can_finance('financeiro.estornar') then
    raise exception using errcode = '42501', message = 'Sem permissão para reclassificar lançamentos.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null or length(trim(p_reason)) < 3 then
    raise exception using errcode = '22023', message = 'Informe o motivo da reclassificação.';
  end if;
  -- Antes vinha de dentro de set_payable_finance_classification.
  if not private.current_user_can_payables('contas_pagar.baixar') then
    raise exception using errcode = '42501', message = 'Sem permissão para classificar contas da JC.';
  end if;

  return private.apply_payable_finance_classification(
    p_purchase_id, p_account_key, p_categories, trim(p_reason), null, true
  );
end;
$$;

commit;
