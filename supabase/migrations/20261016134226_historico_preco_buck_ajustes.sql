-- Tabela Buck com data de validade: ajustes da revisao adversarial do codigo
-- (fase 1, mesma PR de 20261016131454).
--
-- Achados corrigidos aqui, cada um provado no banco local antes da correcao:
--   1. A tela de tabelas salva o preco a cada tecla. Ao digitar "12,32" num
--      produto novo, o primeiro "1" virava o preco "desde sempre" e o resto
--      valia so de hoje: a semana parada por falta de preco destravava a
--      R$ 1,00. Agora gravacoes seguidas da mesma pessoa na mesma linha, em
--      ate 10 minutos, sao a mesma edicao e herdam a data do comeco dela.
--   2. Linha nova de um produto que ja tinha historico na Buck (outra opcao
--      de venda, a ponte pao legado <-> produto, ou a mesma linha excluida e
--      incluida de novo) entrava "desde sempre" e mudava o passado. Agora so
--      vale desde sempre quando o produto nunca teve preco na Buck.
--   3. Trocar a tabela BUCK por outra com o mesmo nome (copiar, desativar a
--      antiga, renomear a copia) deixava as linhas novas sem historico e
--      travava toda a cobranca. Agora a tabela que vira Buck ganha o
--      historico das linhas que ainda nao tinham.
--   4. Apagar uma opcao de venda poe null em `sale_option_id` (ON DELETE SET
--      NULL) e o gatilho recusava. A conta nao usa a opcao de venda; ela sai
--      da trava de identidade.
--   5. O autor de gravacao sem perfil (service role, migration) ficava como o
--      dono da funcao. Agora registra o papel de quem chamou.
--   6. O desvio para a troca com data saiu: nao tem consumidor nesta fase.
--   7. Preco igual com escala diferente (11 e 11.00) agrupava com um
--      representante qualquer; a impressao digital podia divergir entre a
--      lista e a confirmacao. Agora o preco e normalizado (trim_scale).
--   8. A previa do Contas a receber ordena as linhas do mesmo produto pela
--      data, e o Fechamento EX aceita periodo de ate tres anos.
--
-- Mesmos nomes, argumentos e colunas de retorno: deploy aditivo.

begin;

lock table public.price_tier_items in share row exclusive mode;

-- ---------------------------------------------------------------------------
-- Identidade de produto na Buck: a propria e a ponte pao legado <-> produto.
-- ---------------------------------------------------------------------------
create or replace function private.buck_identidades(p_source text, p_id text)
returns table (fonte text, pid text)
language sql
stable
security definer
set search_path = ''
as $fn$
  select p_source, p_id
  union
  select 'bread', produto.legacy_bread_id
  from public.products produto
  where p_source = 'product' and produto.id::text = p_id and produto.legacy_bread_id is not null
  union
  select 'product', produto.id::text
  from public.products produto
  where p_source = 'bread' and produto.legacy_bread_id = p_id;
$fn$;

revoke all on function private.buck_identidades(text, text) from public, anon, authenticated;

-- Quem gravou, quando nao ha perfil: o papel da chamada (service_role,
-- authenticated) ou a sessao do banco (migration).
create or replace function private.buck_autor_sem_perfil()
returns text
language sql
stable
set search_path = ''
as $fn$
  select coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''),
    nullif(current_setting('request.jwt.claim.role', true), ''),
    session_user::text
  );
$fn$;

revoke all on function private.buck_autor_sem_perfil() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Gatilho, com as regras corrigidas
-- ---------------------------------------------------------------------------
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
    -- Desde sempre so quando o produto nunca teve preco na Buck: outra opcao
    -- de venda, a ponte ou a mesma linha incluida de novo nao mudam o passado.
    if exists (
      select 1
      from public.buck_price_history historico
      join private.buck_identidades(v_linha.product_source, v_linha.product_id) ident
        on ident.fonte = historico.product_source and ident.pid = historico.product_id
      where historico.tier_id = v_buck
    ) then
      v_validade := v_hoje;
    else
      v_validade := private.buck_preco_desde_sempre();
    end if;
  elsif v_preco is not distinct from v_atual.unit_price
        and v_unidade is not distinct from v_atual.pricing_unit then
    -- Pacote, nome, opcao de venda ou outra coluna: o preco nao mudou.
    return null;
  elsif tg_op = 'DELETE' then
    v_evento := 'exclusao';
    v_validade := case when v_atual_positivo then v_hoje else v_atual.valid_from end;
  elsif v_preco is null then
    v_evento := 'remocao';
    v_validade := case when v_atual_positivo then v_hoje else v_atual.valid_from end;
  elsif not v_atual_positivo then
    -- Primeiro preco, reativacao ou 0 -> X: preenche o buraco desde que a
    -- linha ficou sem preco. Uma semana parada por falta de preco destrava.
    v_evento := 'primeiro_preco';
    v_validade := v_atual.valid_from;
  elsif v_unidade is distinct from v_atual.pricing_unit then
    -- Unidade errada e acerto de cadastro: corrige o periodo vigente.
    v_evento := 'troca_de_unidade';
    v_validade := v_atual.valid_from;
  else
    v_evento := 'troca_de_preco';
    v_validade := v_hoje;
  end if;

  -- A tela antiga salva a cada tecla: "12,32" chega como 1, 12, 12.3 e 12.32.
  -- Gravacoes seguidas da mesma pessoa na mesma linha, em ate 10 minutos, sao
  -- uma edicao so e herdam a data do comeco dela. Sem isso, o primeiro digito
  -- de um preco novo virava o preco do passado.
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
-- Linhas sem historico (tabela que acabou de virar Buck)
-- ---------------------------------------------------------------------------
create or replace function private.buck_historico_completar()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_buck uuid := private.buck_tier_id();
  v_inseridas integer;
begin
  if v_buck is null then
    return 0;
  end if;

  insert into public.buck_price_history (
    price_tier_item_id, tier_id, product_source, product_id, sale_option_id,
    product_name, unit_price, pricing_unit, valid_from, event, origin, created_by_name
  )
  select linha.id, linha.tier_id, linha.product_source, linha.product_id, linha.sale_option_id,
         linha.product_name,
         case when linha.active then linha.unit_price end,
         case when linha.active then linha.pricing_unit end,
         private.buck_preco_desde_sempre(), 'carga_inicial', 'migracao', 'Carga inicial'
  from public.price_tier_items linha
  where linha.tier_id = v_buck
    and not exists (
      select 1 from public.buck_price_history historico
      where historico.price_tier_item_id = linha.id
    )
  order by linha.id;

  get diagnostics v_inseridas = row_count;
  return v_inseridas;
end;
$fn$;

revoke all on function private.buck_historico_completar() from public, anon, authenticated;

create or replace function private.completar_historico_ao_virar_buck()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if private.buck_tier_id() = new.id then
    perform private.buck_historico_completar();
  end if;
  return null;
end;
$fn$;

revoke all on function private.completar_historico_ao_virar_buck() from public, anon, authenticated;

drop trigger if exists price_tiers_completar_historico_buck on public.price_tiers;

create trigger price_tiers_completar_historico_buck
after insert or update of name, active on public.price_tiers
for each row execute function private.completar_historico_ao_virar_buck();

-- A carga inicial passa a usar a mesma regra de completar.
create or replace function private.buck_historico_carga_inicial()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_buck uuid := private.buck_tier_id();
  v_troca record;
  v_linha public.price_tier_items%rowtype;
  v_aplicadas integer := 0;
begin
  if v_buck is null then
    return 0;
  end if;

  perform private.buck_historico_completar();

  -- Preco antigo das cobrancas confirmadas antes da troca; data da troca nos
  -- registros de acesso (PATCH em price_tier_items, horario de Brasilia).
  for v_troca in
    select *
    from (values
      ('Italiano', 'un', 4.50::numeric, 5.89::numeric, date '2026-10-09'),
      ('Pão de Azeitonas', 'un', 9.50::numeric, 12.32::numeric, date '2026-10-09'),
      ('Italiano de Queijo e Oregano', 'un', 7.50::numeric, 11.00::numeric, date '2026-10-01'),
      ('Pão de Tapioca', 'un', 5.99::numeric, 6.00::numeric, date '2026-09-21')
    ) as troca(produto, unidade, preco_antigo, preco_novo, desde)
  loop
    for v_linha in
      select linha.*
      from public.price_tier_items linha
      where linha.tier_id = v_buck
        and linha.active
        and linha.product_name = v_troca.produto
        and linha.pricing_unit = v_troca.unidade
        and linha.unit_price = v_troca.preco_novo
        and (
          select count(*) from public.buck_price_history historico
          where historico.price_tier_item_id = linha.id
        ) = 1
        and exists (
          select 1 from public.buck_price_history historico
          where historico.price_tier_item_id = linha.id
            and historico.event = 'carga_inicial'
            and historico.unit_price = v_troca.preco_novo
        )
      order by linha.id
    loop
      insert into public.buck_price_history (
        price_tier_item_id, tier_id, product_source, product_id, sale_option_id,
        product_name, unit_price, pricing_unit, valid_from, event, origin, created_by_name
      ) values
        (v_linha.id, v_linha.tier_id, v_linha.product_source, v_linha.product_id, v_linha.sale_option_id,
         v_linha.product_name, v_troca.preco_antigo, v_troca.unidade,
         private.buck_preco_desde_sempre(), 'carga_inicial', 'migracao', 'Carga inicial'),
        (v_linha.id, v_linha.tier_id, v_linha.product_source, v_linha.product_id, v_linha.sale_option_id,
         v_linha.product_name, v_troca.preco_novo, v_troca.unidade,
         v_troca.desde, 'troca_de_preco', 'migracao', 'Carga inicial');
      -- O registro mais recente vence: o preco antigo "desde sempre" entra
      -- depois da carga com o preco atual, e a troca depois dele.

      v_aplicadas := v_aplicadas + 1;
    end loop;
  end loop;

  return v_aplicadas;
end;
$fn$;

revoke all on function private.buck_historico_carga_inicial() from public, anon, authenticated;

-- Conferencia da carga feita pela migration anterior: quantas linhas da Buck
-- tem historico e quantas trocas conhecidas entraram. Sai no log da Action.
do $carga$
declare
  v_linhas integer;
  v_sem_historico integer;
  v_trocas integer;
begin
  select count(*) into v_linhas
  from public.price_tier_items linha where linha.tier_id = private.buck_tier_id();
  select count(*) into v_sem_historico
  from public.price_tier_items linha
  where linha.tier_id = private.buck_tier_id()
    and not exists (select 1 from public.buck_price_history historico where historico.price_tier_item_id = linha.id);
  select count(*) into v_trocas
  from public.buck_price_history historico
  where historico.origin = 'migracao' and historico.event = 'troca_de_preco';
  raise notice 'Tabela Buck: % linhas, % sem historico, % trocas conhecidas na carga inicial.',
    v_linhas, v_sem_historico, v_trocas;
end
$carga$;

-- ---------------------------------------------------------------------------
-- A conta, com o preco normalizado
-- ---------------------------------------------------------------------------
-- Partida de 20261016131454; unica mudanca: trim_scale no preco do dia, para
-- 11 e 11.00 serem o mesmo preco no agrupamento e na impressao digital.
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
  linhas_buck as (
    select distinct historico.price_tier_item_id, historico.product_source, historico.product_id
    from public.buck_price_history historico
    where historico.tier_id = private.buck_tier_id()
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

-- Previa do Contas a receber: o mesmo produto em duas linhas sai na ordem das
-- datas, como no Fechamento EX.
create or replace function private.calcular_cobranca_buck(p_de date, p_ate date)
returns table (
  produto text,
  unidade text,
  quantidade numeric,
  preco_unitario numeric,
  total numeric,
  problemas text[]
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select detalhe.produto, detalhe.unidade, detalhe.quantidade,
         detalhe.preco_unitario, detalhe.total, detalhe.problemas
  from private.calcular_cobranca_buck_detalhada(p_de, p_ate) detalhe
  order by detalhe.produto, detalhe.unidade, (detalhe.itens -> 0 ->> 'record_date'),
           detalhe.preco_unitario nulls first;
$fn$;

revoke all on function private.calcular_cobranca_buck(date, date) from public, anon, authenticated;

-- Fechamento EX: periodo de ate tres anos (antes nao havia limite).
create or replace function public.list_romaneio_ex_billing(p_de date, p_ate date)
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
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not private.pode_ler_fechamento_ex() then
    raise exception using errcode = '42501', message = 'Sem permissão para ver o Fechamento EX.';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception using errcode = '22023', message = 'Informe um período válido.';
  end if;
  if p_ate - p_de > 1100 then
    raise exception using errcode = '22023', message = 'Escolha um período de até três anos.';
  end if;

  return query
  select detalhe.product_source, detalhe.product_id, detalhe.produto, detalhe.unidade,
         detalhe.quantidade, detalhe.preco_unitario, detalhe.total, detalhe.problemas,
         detalhe.itens
  from private.calcular_cobranca_buck_detalhada(p_de, p_ate) detalhe;
end;
$fn$;

revoke all on function public.list_romaneio_ex_billing(date, date) from public, anon;
grant execute on function public.list_romaneio_ex_billing(date, date) to authenticated;

commit;
