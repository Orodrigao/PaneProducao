-- A Expedicao passa a poder fechar a contagem de sobras da loja concedida.
--
-- O QUE ACONTECIA: a marcacao "Dar destino as sobras" existia desde 04/08 e
-- funciona (o login expedicao registrou 20 destinos entre 24 e 26/08), mas ela
-- cobre apenas resolver um lote ja lancado. Fechar a contagem do dia passa por
-- outra porta, `register_bread_leftovers`, que so aceitava os perfis admin,
-- producao e vendas e nao consultava permissao nenhuma. Em 27/08, as 13:25 UTC,
-- a Expedicao tentou fechar a JC duas vezes e levou 403 nas duas; dois minutos
-- depois o mesmo fechamento passou pelo login admin. A pessoa via a tela
-- inteira, digitava a contagem e so descobria a recusa ao salvar.
--
-- A ESCOLHA: permissao nova e separada em vez de incluir o cargo `expedicao` na
-- lista. Cargo na lista libera todo mundo daquele cargo, para sempre e em
-- qualquer loja. Permissao por loja e concedida a quem faz o trabalho, e sai na
-- mesma tela onde entrou, sem PR nenhum.
--
-- REVERSAO: desmarcar a permissao na tela de usuarios devolve o comportamento
-- anterior na hora. Nenhuma condicao existente foi removida, entao admin,
-- producao e vendas continuam fechando exatamente como fechavam.

insert into public.app_permissions (key, module, label, description, sort_order)
values (
  'sobras.registrar',
  'Operacao',
  'Registrar sobras do dia',
  'Fechar a contagem de sobras da loja, o que hoje trava o fechamento seguinte.',
  50
)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order
where (app_permissions.module, app_permissions.label,
       app_permissions.description, app_permissions.sort_order)
  is distinct from
      (excluded.module, excluded.label,
       excluded.description, excluded.sort_order);

-- Nenhuma concessao a pessoa nomeada aqui. A migration de 04/08 chumbou a
-- permissao de destino no perfil "Gustavo" pelo nome; o crachas mudou de dono e
-- a concessao ficou no banco sem forma de desfazer pela tela. Quem concede e o
-- Rodrigo, em /admin/usuarios.

create or replace function public.register_bread_leftovers(
  p_record_date date,
  p_store text,
  p_items jsonb,
  p_physical_location text default 'balcao_fechamento'
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_name text;
  v_profile_role text;
  v_profile_store text;
  v_profile_found boolean;
  v_item jsonb;
  v_bread_id text;
  v_quantity numeric;
  v_actual_id uuid;
  v_lot_code text;
  v_reconciliation_status text;
  v_sobra public.sobras%rowtype;
  v_resolved numeric;
  v_pending numeric;
  v_sobra_found boolean;
  v_count integer := 0;
  v_awaiting_count integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Entre com e-mail para registrar sobras.';
  end if;

  select display_name, role, store
  into v_profile_name, v_profile_role, v_profile_store
  from public.app_profiles
  where user_id = v_user_id and active;
  v_profile_found := found;

  -- A loja precisa ser valida ANTES da autorizacao: e ela que define o escopo
  -- consultado. Autorizar sobre entrada nao validada e como conferir a chave
  -- antes de saber qual porta a pessoa quer abrir.
  --
  -- O `p_store is null` explicito nao e redundante: em SQL `null not in (...)`
  -- devolve null, e `if null then` nao entra. Sem essa linha, loja nula
  -- atravessa a validacao inteira e chega ao insert, criando sobra sem loja.
  if p_record_date is null or p_store is null or p_store not in ('jc', 'ja') then
    raise exception using errcode = '22023', message = 'Informe data e loja JC ou JA.';
  end if;

  if not v_profile_found or not (
    v_profile_role in ('admin', 'producao', 'vendas')
    or private.current_user_has_permission('sobras.registrar', p_store)
  ) then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para registrar sobras.';
  end if;

  if p_record_date > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception using errcode = '22023', message = 'A data do fechamento nao pode estar no futuro.';
  end if;

  if v_profile_role = 'vendas' and v_profile_store is distinct from p_store then
    raise exception using errcode = '42501', message = 'A atendente so pode registrar a propria loja.';
  end if;

  if p_physical_location not in ('balcao_fechamento', 'mesa_separacao', 'padaria_cozinha') then
    raise exception using errcode = '22023', message = 'Local fisico invalido.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    raise exception using errcode = '22023', message = 'Lista de sobras invalida.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('leftovers:' || p_store || ':' || p_record_date::text, 0)
  );

  if exists (
    select 1 from public.sobras
    where store = p_store
      and pending_quantity > 0
      and record_date < p_record_date
  ) then
    raise exception using
      errcode = '23514',
      message = 'Resolva as sobras pendentes do dia anterior antes de fechar hoje.';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_bread_id := nullif(btrim(v_item ->> 'bread_id'), '');
    if v_bread_id is null
      or coalesce(v_item ->> 'quantity', '') !~ '^([0-9]+)([.][0-9]+)?$' then
      raise exception using errcode = '22023', message = 'Pao ou quantidade invalida na lista.';
    end if;

    v_quantity := (v_item ->> 'quantity')::numeric;
    if v_quantity < 0 then
      raise exception using errcode = '22023', message = 'Quantidade nao pode ser negativa.';
    end if;

    if not exists (
      select 1
      from public.breads
      where id = v_bread_id and active and not coalesce(is_pj, false)
    ) then
      raise exception using errcode = '23503', message = 'Pao ativo nao encontrado.';
    end if;

    select id, lot_code
    into v_actual_id, v_lot_code
    from public.production_actuals
    where bread_id = v_bread_id and record_date = p_record_date;

    if v_actual_id is null then
      v_lot_code := 'L' || to_char(p_record_date, 'MMDD');
    end if;

    v_reconciliation_status := case
      when v_quantity = 0 and v_actual_id is null then 'not_required'
      when v_actual_id is null then 'awaiting_oven'
      else 'confirmed'
    end;

    select * into v_sobra
    from public.sobras
    where store = p_store
      and product_source = 'bread'
      and product_id = v_bread_id
      and record_date = p_record_date
    for update;
    v_sobra_found := found;

    if v_quantity = 0 and not v_sobra_found then
      continue;
    end if;

    if not v_sobra_found then
      insert into public.sobras (
        record_date, responsible, product_id, product_source, quantity,
        store, production_actual_id, lot_code, pending_quantity, status,
        physical_location, reconciliation_status, updated_at
      ) values (
        p_record_date, v_profile_name, v_bread_id, 'bread', v_quantity,
        p_store, v_actual_id, v_lot_code, v_quantity,
        case when v_quantity > 0 then 'pending' else 'cancelled' end,
        p_physical_location, v_reconciliation_status, now()
      )
      returning * into v_sobra;

      insert into public.bread_leftover_events (
        sobra_id, action, quantity, to_location, actor_id, actor_name, obs
      ) values (
        v_sobra.id, 'registered', v_quantity, p_physical_location,
        v_user_id, v_profile_name,
        case when v_actual_id is null then 'Registrada antes da confirmacao do Forno.' else null end
      );
    else
      v_resolved := v_sobra.quantity - v_sobra.pending_quantity;
      if v_quantity < v_resolved then
        raise exception using
          errcode = '23514',
          message = 'A nova quantidade e menor que o total que ja recebeu destino.';
      end if;

      v_pending := v_quantity - v_resolved;
      update public.sobras
      set quantity = v_quantity,
          pending_quantity = v_pending,
          status = case
            when v_quantity = 0 then 'cancelled'
            when v_pending > 0 then 'pending'
            else 'resolved'
          end,
          physical_location = p_physical_location,
          responsible = v_profile_name,
          production_actual_id = coalesce(v_actual_id, production_actual_id),
          lot_code = coalesce(v_lot_code, lot_code),
          reconciliation_status = case
            when coalesce(v_actual_id, production_actual_id) is not null then 'confirmed'
            else v_reconciliation_status
          end,
          updated_at = now()
      where id = v_sobra.id;

      insert into public.bread_leftover_events (
        sobra_id, action, quantity, from_location, to_location,
        actor_id, actor_name, obs
      ) values (
        v_sobra.id, 'corrected', v_quantity, v_sobra.physical_location,
        p_physical_location, v_user_id, v_profile_name,
        case
          when v_actual_id is null
            then 'Quantidade total corrigida; destinos anteriores preservados; aguardando Forno.'
          else 'Quantidade total corrigida; destinos anteriores preservados.'
        end
      );
    end if;

    if v_reconciliation_status = 'awaiting_oven' then
      v_awaiting_count := v_awaiting_count + 1;
    end if;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'saved_items', v_count,
    'awaiting_oven_items', v_awaiting_count,
    'store', p_store,
    'record_date', p_record_date
  );
end;
$$;

comment on function public.register_bread_leftovers(date, text, jsonb, text) is
  'Registra a contagem fisica de JC/JA mesmo antes do Forno e marca a conciliacao pendente sem criar producao. Aceita admin, producao, vendas ou quem tiver sobras.registrar na loja do fechamento.';
