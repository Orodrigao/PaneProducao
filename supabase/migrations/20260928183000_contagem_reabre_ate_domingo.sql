-- Contagem semanal de estoque: quem conta reabre a propria contagem ate domingo.
--
-- Decisao do Rodrigo em 2026-09-28 (substitui em parte a regra de 2026-09-20,
-- "so admin reabre"): quem pode contar a loja -- expedicao da JC com a
-- permissao estoque.contar_semanal, ou admin -- reabre a contagem da semana ate
-- o domingo daquela semana, 23:59 no relogio da padaria. Depois disso so o
-- admin reabre. Motivo: em 26/09 a contagem foi fechada no meio, com 15 de 59
-- itens contados, e so o admin conseguia desfazer.
--
-- A semana da contagem comeca na segunda (week_start, de date_trunc('week')) e
-- o prazo termina no domingo seguinte (week_start + 6). O prazo acaba no mesmo
-- instante em que a semana seguinte comeca, entao quem conta nunca tem duas
-- contagens reabriveis ao mesmo tempo.
--
-- As funcoes de abrir e salvar sao redefinidas somente para trocar a mensagem
-- que mandava "pedir para o admin reabrir": agora quem conta tambem reabre
-- (licao texto-envelhece-com-o-sistema). O corpo delas e copia literal da
-- definicao de 20260921000000_contagem_semanal_estoque.sql, a unica existente.

begin;

-- ---------------------------------------------------------------------------
-- O prazo de quem conta, isolado para ser testado com horario explicito.
-- ---------------------------------------------------------------------------
-- Sem semana (nulo) devolve falso: na duvida, bloqueia (licao
-- caso-padrao-na-fronteira). O admin nao passa por aqui.
create or replace function private.contagem_semanal_no_prazo_de_quem_conta(
  p_week_start date,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.data_na_padaria(p_at) <= p_week_start + 6, false);
$$;

revoke all on function private.contagem_semanal_no_prazo_de_quem_conta(date, timestamptz)
  from public, anon, authenticated;

comment on function private.contagem_semanal_no_prazo_de_quem_conta(date, timestamptz) is
  'Quem conta (nao admin) reabre a contagem semanal ate o domingo da semana (week_start + 6), 23:59 em America/Sao_Paulo.';

-- ---------------------------------------------------------------------------
-- Reabrir: admin sempre; quem conta a loja, ate o domingo da semana.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_inventory_weekly_count(p_count_id uuid)
returns public.inventory_weekly_counts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_is_admin boolean;
  v_store text;
  v_week_start date;
  v_status text;
  v_now timestamptz;
  v_count public.inventory_weekly_counts;
begin
  if p_count_id is null then
    raise exception using errcode = '22023', message = 'Contagem obrigatoria.';
  end if;

  -- Loja e semana nunca mudam depois de criadas (nenhuma funcao as altera);
  -- aqui servem so para achar a trava. Quem pode e o prazo sao decididos
  -- depois da trava, para uma chamada que esperou nao usar permissao ou
  -- relogio velhos (revisao do Sol, 2026-09-28).
  select count_row.store, count_row.week_start
  into v_store, v_week_start
  from public.inventory_weekly_counts count_row
  where count_row.id = p_count_id;

  if v_store is null then
    raise exception using errcode = 'P0002', message = 'Contagem semanal nao encontrada.';
  end if;

  -- Mesma trava de abrir: por loja+semana, nao existe caminho para colidir
  -- com o indice unico (so ha uma linha por loja+semana), mas a trava mantem
  -- abrir e reabrir simetricos e cobertos pelo mesmo teste de concorrencia.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('paneerp:inventory-weekly-count:' || v_store || ':' || v_week_start::text, 0)
  );

  select count_row.status
  into v_status
  from public.inventory_weekly_counts count_row
  where count_row.id = p_count_id
  for update;

  if v_status is null then
    raise exception using errcode = 'P0002', message = 'Contagem semanal nao encontrada.';
  end if;

  -- Mesma regra de quem conta e fecha: admin ativo, ou expedicao ativa da loja
  -- com a permissao estoque.contar_semanal no escopo da loja ou '*'.
  select autorizado.user_id, autorizado.display_name
  into v_user_id, v_user_name
  from private.pode_contar_estoque_semanal(v_store) autorizado;

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Sem permissao para reabrir esta contagem.';
  end if;

  select exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = v_user_id
      and profile.active
      and profile.role = 'admin'
  )
  into v_is_admin;

  -- clock_timestamp(), e nao now(): now() e o inicio da transacao, e uma
  -- chamada de domingo 23:59 que so terminasse na segunda passaria. Lido uma
  -- vez so: o mesmo instante decide o prazo e fica gravado em reopened_at
  -- (licao ordem-na-mesma-transacao; achado do CodeRabbit).
  v_now := pg_catalog.clock_timestamp();

  if not v_is_admin
    and not private.contagem_semanal_no_prazo_de_quem_conta(v_week_start, v_now) then
    raise exception using errcode = '42501',
      message = 'O prazo para reabrir esta contagem terminou no domingo '
        || pg_catalog.to_char(v_week_start + 6, 'DD/MM')
        || '. Agora so o admin reabre.';
  end if;

  if v_status = 'aberta' then
    select * into v_count from public.inventory_weekly_counts where id = p_count_id;
    return v_count;
  end if;

  update public.inventory_weekly_counts
  set status = 'aberta',
      reopened_at = v_now,
      reopened_by = v_user_id,
      reopened_by_name = v_user_name
  where id = p_count_id
  returning * into v_count;

  return v_count;
end;
$$;

revoke all on function public.reopen_inventory_weekly_count(uuid) from public, anon;
grant execute on function public.reopen_inventory_weekly_count(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Abrir: copia literal de 20260921000000, so a mensagem de semana fechada muda.
-- ---------------------------------------------------------------------------
create or replace function public.open_inventory_weekly_count(p_store text default 'jc')
returns public.inventory_weekly_counts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_week_start date;
  v_count public.inventory_weekly_counts;
begin
  if p_store is distinct from 'jc' then
    raise exception using errcode = '22023', message = 'Contagem semanal so existe para a JC nesta fase.';
  end if;

  select autorizado.user_id, autorizado.display_name
  into v_user_id, v_user_name
  from private.pode_contar_estoque_semanal(p_store) autorizado;

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Sem permissao para abrir a contagem semanal.';
  end if;

  v_week_start := pg_catalog.date_trunc('week', private.data_na_padaria())::date;

  -- Duas aberturas simultaneas da mesma loja/semana disputariam o indice
  -- unico com erro cru; a trava serializa e a segunda chamada so encontra a
  -- contagem que a primeira acabou de criar (mesmo padrao de
  -- private.lock_financial_request).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('paneerp:inventory-weekly-count:' || p_store || ':' || v_week_start::text, 0)
  );

  select * into v_count
  from public.inventory_weekly_counts existing
  where existing.store = p_store
    and existing.week_start = v_week_start;

  if v_count.id is not null then
    if v_count.status = 'fechada' then
      raise exception using errcode = '22023',
        message = 'A contagem desta semana ja foi fechada. Para corrigir, reabra a contagem.';
    end if;
    return v_count;
  end if;

  insert into public.inventory_weekly_counts (store, week_start, opened_by, opened_by_name)
  values (p_store, v_week_start, v_user_id, v_user_name)
  returning * into v_count;

  -- Fotografa agora quem entra nesta rodada. Produto marcado ou desmarcado
  -- depois deste instante nao muda a lista desta semana (achado do Sol):
  -- comeca a valer na proxima abertura.
  insert into public.inventory_weekly_count_items (count_id, product_id, unit)
  select v_count.id, product_row.id, product_row.unit
  from public.products product_row
  where product_row.weekly_count_enabled
    and product_row.active
    and product_row.kind = 'insumo';

  return v_count;
end;
$$;

revoke all on function public.open_inventory_weekly_count(text) from public, anon;
grant execute on function public.open_inventory_weekly_count(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Salvar: copia literal de 20260921000000, so a mensagem de contagem fechada muda.
-- ---------------------------------------------------------------------------
create or replace function public.save_inventory_weekly_count_item(
  p_count_id uuid,
  p_product_id uuid,
  p_quantity numeric
)
returns public.inventory_weekly_count_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_store text;
  v_status text;
  v_item public.inventory_weekly_count_items;
begin
  if p_count_id is null or p_product_id is null then
    raise exception using errcode = '22023', message = 'Contagem e insumo sao obrigatorios.';
  end if;

  if p_quantity is not null and p_quantity < 0 then
    raise exception using errcode = '22023', message = 'Quantidade contada nao pode ser negativa.';
  end if;

  select count_row.store, count_row.status
  into v_store, v_status
  from public.inventory_weekly_counts count_row
  where count_row.id = p_count_id
  for update;

  if v_store is null then
    raise exception using errcode = 'P0002', message = 'Contagem semanal nao encontrada.';
  end if;

  select autorizado.user_id, autorizado.display_name
  into v_user_id, v_user_name
  from private.pode_contar_estoque_semanal(v_store) autorizado;

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Sem permissao para contar nesta loja.';
  end if;

  if v_status <> 'aberta' then
    raise exception using errcode = '22023',
      message = 'Esta contagem ja foi fechada. Para corrigir, ela precisa ser reaberta.';
  end if;

  -- O insumo precisa fazer parte da fotografia tirada na abertura. Marcar um
  -- insumo novo no cadastro no meio da semana nao o insere nesta rodada
  -- (achado do Sol) -- ele entra a partir da proxima abertura.
  update public.inventory_weekly_count_items
  set quantity = p_quantity,
      updated_at = now(),
      updated_by = v_user_id,
      updated_by_name = v_user_name
  where count_id = p_count_id
    and product_id = p_product_id
  returning * into v_item;

  if v_item.id is null then
    raise exception using errcode = '22023', message = 'Este insumo nao faz parte da contagem desta semana.';
  end if;

  return v_item;
end;
$$;

revoke all on function public.save_inventory_weekly_count_item(uuid, uuid, numeric) from public, anon;
grant execute on function public.save_inventory_weekly_count_item(uuid, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- O texto da permissao, que aparece na tela de usuarios, diz o poder novo.
-- ---------------------------------------------------------------------------
update public.app_permissions
set "description" = 'Registrar, fechar e reabrir (ate o domingo da semana) a contagem semanal de insumos da JC.'
where "key" = 'estoque.contar_semanal';

commit;
