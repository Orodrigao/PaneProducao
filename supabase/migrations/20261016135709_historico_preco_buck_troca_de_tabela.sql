-- Tabela Buck com data de validade: troca da tabela BUCK por outra (fase 1,
-- mesma PR de 20261016131454 e 20261016134226; achado do CodeRabbit).
--
-- Antes: quando uma copia virava a BUCK, as linhas dela ganhavam o preco de
-- hoje "desde sempre", e a conta so lia o historico da tabela Buck atual. As
-- semanas ainda nao cobradas e o Fechamento EX voltavam a usar o preco de hoje
-- para o passado, o defeito que esta entrega corrige.
--
-- Agora:
--   * a conta le o historico de todas as linhas que ja foram da Buck (o
--     gatilho so grava linha da Buck, entao todo registro e de uma Buck);
--   * a tabela que deixa de ser a Buck (desativada, renomeada ou apagada) tira
--     o preco das linhas dela de hoje em diante;
--   * linha que entra na Buck so vale desde sempre quando o produto nunca teve
--     preco em nenhuma Buck; senao vale de hoje.
--
-- Mesmos nomes, argumentos e colunas de retorno: deploy aditivo.

begin;

lock table public.price_tier_items in share row exclusive mode;

-- Produto que ja teve preco em alguma Buck (pela identidade ou pela ponte).
create or replace function private.buck_produto_ja_teve_preco(p_source text, p_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
    from public.buck_price_history historico
    join private.buck_identidades(p_source, p_id) ident
      on ident.fonte = historico.product_source and ident.pid = historico.product_id
  );
$fn$;

revoke all on function private.buck_produto_ja_teve_preco(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Gatilho da linha: desde sempre so para produto que nunca teve preco na Buck
-- ---------------------------------------------------------------------------
-- Partida de 20261016134226; unica mudanca: a consulta de "ja teve preco"
-- olha o historico de qualquer tabela que ja foi a Buck.
create or replace function private.registrar_historico_preco_buck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_buck uuid := private.buck_tier_id();
  v_hoje date := private.data_na_padaria();
  v_linha public.price_tier_items%rowtype;
  v_atual public.buck_price_history%rowtype;
  v_tem_atual boolean;
  v_atual_positivo boolean;
  v_preco numeric;
  v_unidade text;
  v_evento text;
  v_validade date;
  v_autor uuid := (select auth.uid());
  v_nome text;
begin
  if v_buck is null then
    return null;
  end if;

  if tg_op = 'UPDATE'
     and (old.tier_id = v_buck or new.tier_id = v_buck)
     and (old.tier_id is distinct from new.tier_id
          or old.product_id is distinct from new.product_id
          or old.product_source is distinct from new.product_source) then
    raise exception using errcode = '22023',
      message = 'Uma linha da Tabela Buck não muda de produto nem de tabela. Remova a linha e inclua o produto certo.';
  end if;

  if tg_op = 'DELETE' then
    v_linha := old;
  else
    v_linha := new;
  end if;

  if v_linha.tier_id is distinct from v_buck then
    return null;
  end if;

  select historico.* into v_atual
  from public.buck_price_history historico
  where historico.price_tier_item_id = v_linha.id
  order by historico.seq desc
  limit 1;
  v_tem_atual := found;
  v_atual_positivo := v_tem_atual and coalesce(v_atual.unit_price, 0) > 0;

  if tg_op = 'DELETE' then
    v_preco := null;
    v_unidade := null;
  elsif new.active then
    v_preco := new.unit_price;
    v_unidade := new.pricing_unit;
  else
    v_preco := null;
    v_unidade := null;
  end if;

  if tg_op = 'INSERT' or not v_tem_atual then
    v_evento := 'cadastro';
    if private.buck_produto_ja_teve_preco(v_linha.product_source, v_linha.product_id) then
      v_validade := v_hoje;
    else
      v_validade := private.buck_preco_desde_sempre();
    end if;
  elsif v_preco is not distinct from v_atual.unit_price
        and v_unidade is not distinct from v_atual.pricing_unit then
    return null;
  elsif tg_op = 'DELETE' then
    v_evento := 'exclusao';
    v_validade := case when v_atual_positivo then v_hoje else v_atual.valid_from end;
  elsif v_preco is null then
    v_evento := 'remocao';
    v_validade := case when v_atual_positivo then v_hoje else v_atual.valid_from end;
  elsif not v_atual_positivo then
    v_evento := 'primeiro_preco';
    v_validade := v_atual.valid_from;
  elsif v_unidade is distinct from v_atual.pricing_unit then
    v_evento := 'troca_de_unidade';
    v_validade := v_atual.valid_from;
  else
    v_evento := 'troca_de_preco';
    v_validade := v_hoje;
  end if;

  -- Gravacoes seguidas da mesma pessoa na mesma linha, em ate 10 minutos, sao
  -- uma edicao so (a tela antiga salva a cada tecla).
  if v_tem_atual
     and v_evento in ('troca_de_preco', 'remocao', 'exclusao')
     and v_atual.origin = 'tabela'
     and v_atual.created_by is not distinct from v_autor
     and v_atual.created_at > clock_timestamp() - interval '10 minutes' then
    v_validade := v_atual.valid_from;
  end if;

  select profile.display_name into v_nome
  from public.app_profiles profile
  where profile.user_id = v_autor;

  insert into public.buck_price_history (
    price_tier_item_id, tier_id, product_source, product_id, sale_option_id,
    product_name, unit_price, pricing_unit, valid_from,
    previous_unit_price, previous_pricing_unit, event, origin,
    created_by, created_by_name
  ) values (
    v_linha.id, v_linha.tier_id, v_linha.product_source, v_linha.product_id, v_linha.sale_option_id,
    v_linha.product_name, v_preco, v_unidade, v_validade,
    case when v_tem_atual then v_atual.unit_price end,
    case when v_tem_atual then v_atual.pricing_unit end,
    v_evento, 'tabela',
    v_autor, coalesce(v_nome, private.buck_autor_sem_perfil())
  );

  return null;
end;
$fn$;

revoke all on function private.registrar_historico_preco_buck() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tabela que vira a Buck e tabela que deixa de ser
-- ---------------------------------------------------------------------------
-- Linhas sem historico da tabela Buck atual: desde sempre so para produto que
-- nunca teve preco em nenhuma Buck; senao, de hoje.
create or replace function private.buck_historico_completar()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_buck uuid := private.buck_tier_id();
  v_linha public.price_tier_items%rowtype;
  v_inseridas integer := 0;
begin
  if v_buck is null then
    return 0;
  end if;

  -- Uma linha por vez: a segunda linha do mesmo produto ja ve a primeira.
  for v_linha in
    select linha.*
    from public.price_tier_items linha
    where linha.tier_id = v_buck
      and not exists (
        select 1 from public.buck_price_history historico
        where historico.price_tier_item_id = linha.id
      )
    order by linha.id
  loop
    insert into public.buck_price_history (
      price_tier_item_id, tier_id, product_source, product_id, sale_option_id,
      product_name, unit_price, pricing_unit, valid_from, event, origin, created_by_name
    ) values (
      v_linha.id, v_linha.tier_id, v_linha.product_source, v_linha.product_id, v_linha.sale_option_id,
      v_linha.product_name,
      case when v_linha.active then v_linha.unit_price end,
      case when v_linha.active then v_linha.pricing_unit end,
      case when private.buck_produto_ja_teve_preco(v_linha.product_source, v_linha.product_id)
           then private.data_na_padaria()
           else private.buck_preco_desde_sempre() end,
      'carga_inicial', 'migracao', 'Carga inicial'
    );
    v_inseridas := v_inseridas + 1;
  end loop;

  return v_inseridas;
end;
$fn$;

revoke all on function private.buck_historico_completar() from public, anon, authenticated;

-- Tabela que deixa de ser a Buck: as linhas dela ficam sem preco de hoje em
-- diante (o passado continua com o preco que tinham).
create or replace function private.buck_encerrar_tabela(p_tier_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_hoje date := private.data_na_padaria();
  v_autor uuid := (select auth.uid());
  v_nome text;
  v_inseridas integer;
begin
  select profile.display_name into v_nome
  from public.app_profiles profile
  where profile.user_id = v_autor;

  insert into public.buck_price_history (
    price_tier_item_id, tier_id, product_source, product_id, sale_option_id,
    product_name, unit_price, pricing_unit, valid_from,
    previous_unit_price, previous_pricing_unit, event, origin,
    created_by, created_by_name
  )
  select ultimo.price_tier_item_id, ultimo.tier_id, ultimo.product_source, ultimo.product_id,
         ultimo.sale_option_id, ultimo.product_name, null, null, v_hoje,
         ultimo.unit_price, ultimo.pricing_unit, 'remocao', 'tabela',
         v_autor, coalesce(v_nome, private.buck_autor_sem_perfil())
  from (
    select distinct on (historico.price_tier_item_id) historico.*
    from public.buck_price_history historico
    where historico.tier_id = p_tier_id
    order by historico.price_tier_item_id, historico.seq desc
  ) ultimo
  where ultimo.unit_price is not null
  order by ultimo.price_tier_item_id;

  get diagnostics v_inseridas = row_count;
  return v_inseridas;
end;
$fn$;

revoke all on function private.buck_encerrar_tabela(uuid) from public, anon, authenticated;

create or replace function private.historico_ao_mudar_tabela_buck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_era_buck boolean := tg_op in ('UPDATE', 'DELETE') and lower(trim(old.name)) = 'buck' and old.active;
  v_e_buck boolean := tg_op in ('INSERT', 'UPDATE') and lower(trim(new.name)) = 'buck' and new.active;
begin
  if v_era_buck and not v_e_buck then
    perform private.buck_encerrar_tabela(old.id);
  end if;
  if v_e_buck and not v_era_buck then
    perform private.buck_historico_completar();
  end if;
  return null;
end;
$fn$;

revoke all on function private.historico_ao_mudar_tabela_buck() from public, anon, authenticated;

drop trigger if exists price_tiers_completar_historico_buck on public.price_tiers;
drop function if exists private.completar_historico_ao_virar_buck();

create trigger price_tiers_historico_buck
after insert or update of name, active or delete on public.price_tiers
for each row execute function private.historico_ao_mudar_tabela_buck();

-- ---------------------------------------------------------------------------
-- A conta le o historico de todas as linhas que ja foram da Buck
-- ---------------------------------------------------------------------------
-- Partida de 20261016134226; unica mudanca: `linhas_buck` sem o filtro pela
-- tabela Buck atual.
create or replace function private.calcular_cobranca_buck_detalhada(p_de date, p_ate date)
returns table (
  product_source text,
  product_id text,
  produto text,
  unidade text,
  quantidade numeric,
  preco_unitario numeric,
  total numeric,
  problemas text[],
  itens jsonb
)
language sql
stable
security definer
set search_path = ''
as $fn$
  with destino as (
    select d.id from public.destinations d where upper(d.code) = 'EX' and d.active
  ),
  itens as (
    select item.id,
           item.romaneio_id,
           romaneio.record_date,
           romaneio.status as romaneio_status,
           item.product_id,
           item.product_source,
           item.product_name,
           item.qty_sent,
           item.qty_accepted,
           private.romaneio_unidade_cobranca(item.product_name) as unidade,
           private.romaneio_unidade_explicita(item.product_name) as unidade_no_nome,
           greatest(coalesce(item.qty_sent, 0), 0) as enviado,
           greatest(coalesce(item.qty_accepted, item.qty_sent, 0), 0) as cobrado
    from public.romaneio_items item
    join public.romaneios romaneio on romaneio.id = item.romaneio_id
    where romaneio.destination_id in (select id from destino)
      and romaneio.status <> 'separado'
      and romaneio.record_date between p_de and p_ate
  ),
  identidades as (
    select item.id as item_id, item.product_source as fonte, item.product_id as pid, 0 as prioridade
    from itens item
    union all
    select item.id, 'bread', produto.legacy_bread_id, 1
    from itens item
    join public.products produto on produto.id::text = item.product_id
    where item.product_source = 'product' and produto.legacy_bread_id is not null
    union all
    select item.id, 'product', produto.id::text, 1
    from itens item
    join public.products produto on produto.legacy_bread_id = item.product_id
    where item.product_source = 'bread'
  ),
  -- Toda linha que ja foi da Buck: o gatilho so grava linha da Buck.
  linhas_buck as (
    select distinct historico.price_tier_item_id, historico.product_source, historico.product_id
    from public.buck_price_history historico
  ),
  precos_na_data as (
    select ident.item_id,
           ident.prioridade,
           linha.price_tier_item_id,
           trim_scale(preco.unit_price) as unit_price,
           preco.pricing_unit
    from identidades ident
    join itens item on item.id = ident.item_id
    join linhas_buck linha
      on linha.product_source = ident.fonte and linha.product_id = ident.pid
    cross join lateral private.buck_preco_na_data(linha.price_tier_item_id, item.record_date) preco
    where preco.unit_price is not null
  ),
  item_com_preco as (
    select item.*,
           (select p.unit_price
              from precos_na_data p
             where p.item_id = item.id
               and p.pricing_unit = item.unidade
             order by p.prioridade, (p.unit_price > 0) desc, p.price_tier_item_id
             limit 1) as preco,
           exists (select 1
                     from precos_na_data p
                    where p.item_id = item.id
                      and p.pricing_unit in ('un', 'kg')
                      and p.pricing_unit <> item.unidade
                      and p.unit_price > 0) as tem_preco_em_outra_unidade
    from itens item
  ),
  agrupado as (
    select item.product_source,
           item.product_id,
           max(item.product_name) as produto,
           item.unidade,
           item.preco as preco_unitario,
           min(item.record_date) as primeiro_dia,
           sum(item.cobrado) as quantidade,
           bool_or(item.preco is null or item.preco <= 0) as sem_preco,
           bool_or(item.tem_preco_em_outra_unidade and (item.preco is null or item.preco <= 0)) as unidade_errada_preco,
           bool_or(item.unidade_no_nome is not null and item.unidade_no_nome <> item.unidade) as unidade_errada_nome,
           bool_or(item.unidade = 'kg' and (item.enviado > 10 or item.cobrado > 10)) as peso_suspeito,
           jsonb_agg(jsonb_build_object(
             'romaneio_id', item.romaneio_id,
             'romaneio_item_id', item.id,
             'record_date', item.record_date,
             'romaneio_status', item.romaneio_status,
             'qty_sent', item.qty_sent,
             'qty_accepted', item.qty_accepted,
             'quantidade_usada', item.cobrado,
             'origem_quantidade', case when item.qty_accepted is null then 'enviado' else 'aceito' end
           ) order by item.record_date, item.id) as itens
    from item_com_preco item
    group by item.product_source, item.product_id, item.product_name, item.unidade, item.preco
  )
  select g.product_source,
         g.product_id,
         g.produto,
         g.unidade,
         g.quantidade,
         case when g.sem_preco then null else g.preco_unitario end,
         case when g.sem_preco or g.unidade_errada_preco or g.unidade_errada_nome or g.peso_suspeito
              then null
              else round(g.quantidade * g.preco_unitario, 2) end,
         array_remove(array[
           case when g.sem_preco and not g.unidade_errada_preco then 'missing_price' end,
           case when g.unidade_errada_nome or g.unidade_errada_preco then 'unit_mismatch' end,
           case when g.peso_suspeito then 'suspicious_quantity' end
         ], null),
         g.itens
  from agrupado g
  order by g.produto, g.unidade, g.primeiro_dia, g.preco_unitario nulls first;
$fn$;

revoke all on function private.calcular_cobranca_buck_detalhada(date, date) from public, anon, authenticated;

commit;
