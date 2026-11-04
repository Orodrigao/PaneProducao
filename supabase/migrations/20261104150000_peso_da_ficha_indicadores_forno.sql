-- Formação de preço, passos 0c e 0d (docs/FORMACAO_DE_PRECO.md, "Decidido em
-- 2026-10-08" e "Plano em fases", fase 0).
--
-- Rodrigo decidiu em 08/10/2026 que o peso do pão vem da ficha técnica, não de
-- cadastro avulso: a ficha guarda a massa crua por unidade (o que a padeira
-- divide) e, à parte, o peso assado, opcional. A mão de obra de produção é por
-- quilo de massa crua; o peso assado serve para venda e pedido por quilo.
--
-- Até aqui dois lugares liam o peso médio do cadastro de pães
-- (breads.avg_unit_weight_kg), um número digitado à parte que já tinha errado
-- (Brioche Hamburguer com 0,8 kg contou 1,4 t de pão a mais em setembro):
--
--   1. o indicador de mão de obra por quilo
--      (private.pricing_financial_indicators_report), que somava quilos de pão
--      assado pelo cadastro de pães, pela opção de venda ou pela ficha;
--   2. o Forno (public.list_pj_production_for_oven_v2), que convertia pedido PJ
--      por quilo em peças pelo mesmo cadastro.
--
-- Esta migration:
--
--   a. liga o pão da produção à variante do produto quando o pão é uma
--      variante (breads.product_variant_id), com trava nos dois lados do
--      vínculo. Hoje só o "Brioche Hamburguer" é variante do produto Brioche;
--      o Pão de Cachorro Quente é o próprio produto, e a variante Mini é outro
--      tamanho;
--   b. cria uma função única que lê o peso da ficha por unidade
--      (private.ficha_peso_por_unidade), para indicador e Forno não terem cada
--      um a sua regra;
--   c. guarda na Configuração do Sistema o salário mensal dos donos, que entra
--      nas despesas fixas do indicador;
--   d. o indicador passa a somar quilos de massa crua da ficha;
--   e. o Forno converte pedido PJ por quilo pelo peso assado da ficha, linha a
--      linha. Ficha sem peso assado, ou com peso de venda diferente do assado,
--      não converte: o pedido em quilo fica fora do previsto e o Forno avisa,
--      como já fazia sem peso médio. Converter pela massa crua faria o Forno
--      assar menos pão do que o cliente pediu;
--   f. deixa breads.avg_unit_weight_kg sem leitor. A coluna fica (mudança
--      destrutiva é em duas PRs); a tela que a editava sai nesta mesma PR.
--
-- Reversão: migration nova devolvendo as definições de
-- 20260930013002_indicadores_preco_financeiro.sql e
-- 20260916052614_pedidos_producao_variantes_pacotes.sql. Fora a ligação do
-- Brioche Hamburguer à variante (desfeita pondo a coluna em nulo), nada muda
-- nas gravações existentes.

begin;

-- ---------------------------------------------------------------------------
-- a. Pão da produção ligado à variante do produto
-- ---------------------------------------------------------------------------

alter table public.breads
  add column product_variant_id uuid
    references public.product_variants(id) on delete set null;

comment on column public.breads.product_variant_id is
  'Variante do produto ligado a este pão (products.legacy_bread_id) que o pão representa na produção. Nulo: o pão é o próprio produto, sem variante. Indicador de mão de obra e Forno leem o peso da ficha técnica desta variante.';

comment on column public.breads.avg_unit_weight_kg is
  'Desligado na formação de preço, passo 0d (novembro de 2026): nenhuma tela nem função lê este número; o peso vem da ficha técnica (product_recipe_yields). A coluna sai numa PR futura.';

-- A variante precisa ser do produto ligado ao pão; senão a ficha lida seria de
-- outro produto. Só dispara quando a variante é informada.
create function private.conferir_variante_do_pao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where variant.id = new.product_variant_id
      and product.legacy_bread_id = new.id
  ) then
    raise exception using errcode = '23514',
      message = 'A variante precisa ser do produto ligado a este pão.';
  end if;
  return new;
end;
$$;

revoke all on function private.conferir_variante_do_pao()
  from public, anon, authenticated, service_role;

create trigger conferir_variante_do_pao
before insert or update of product_variant_id on public.breads
for each row
when (new.product_variant_id is not null)
execute function private.conferir_variante_do_pao();

-- O outro lado do vínculo: trocar o pão ligado a um produto deixaria a
-- variante gravada no pão apontando para o produto antigo. Quem faz essa
-- passagem (correção administrativa) tira a variante do pão antes.
create function private.conferir_variante_ao_religar_pao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.breads bread
    where bread.id in (old.legacy_bread_id, new.legacy_bread_id)
      and bread.product_variant_id is not null
  ) then
    raise exception using errcode = '23514',
      message = 'O pão ligado tem variante gravada. Tire a variante do pão antes de trocar a ligação.';
  end if;
  return new;
end;
$$;

revoke all on function private.conferir_variante_ao_religar_pao()
  from public, anon, authenticated, service_role;

create trigger conferir_variante_ao_religar_pao
before update of legacy_bread_id on public.products
for each row
when (old.legacy_bread_id is distinct from new.legacy_bread_id)
execute function private.conferir_variante_ao_religar_pao();

-- Correção decidida em 08/10/2026 (cada variante do Brioche tem a própria massa
-- crua: Hambúrguer 80 g, Forma 400 g, Flor 150 g, Mini 30 g). O pão
-- "Brioche Hamburguer" é o que a produção lança e está ligado ao produto
-- Brioche; ele é a variante Hambúrguer. Confere o estado antes de agir: nos
-- bancos de teste não encontra nada e não faz nada.
update public.breads bread
set product_variant_id = variant.id
from public.products product
join public.product_variants variant on variant.product_id = product.id
where product.legacy_bread_id = bread.id
  and bread.product_variant_id is null
  and lower(btrim(bread.name)) = 'brioche hamburguer'
  and lower(btrim(variant.name)) in ('hambúrguer', 'hamburguer');

-- ---------------------------------------------------------------------------
-- b. Peso por unidade lido da ficha técnica
-- ---------------------------------------------------------------------------

-- Devolve, para um item da produção ou da programação, o peso de uma unidade
-- pela linha da ficha (product_recipe_yields) do produto e da variante.
-- Nenhuma linha quando a ficha não tem rendimento. Quem lê trata nulo como
-- "peso desconhecido", nunca como zero nem como outro peso.
--
--   - Pão antigo (source 'bread'): o produto é o ligado ao pão
--     (products.legacy_bread_id); a variante é a informada ou, sem ela, a do
--     pão (breads.product_variant_id). Variante que não é do produto não
--     acha linha na ficha (a chave estrangeira da ficha amarra variante e
--     produto), então vínculo velho fica sem peso em vez de cair na linha do
--     produto.
--   - Produto do catálogo (source 'product'): o próprio produto e a variante
--     informada.
--   - Variante sem linha própria na ficha também não cai na linha do produto:
--     o Brioche Forma (400 g) contaria como o Brioche sem variante. Fica sem
--     peso e aparece na cobertura.
--   - ficha_massa_crua_kg: massa da receita ÷ rendimento, só nas bases massa
--     crua e unidade. Na base "produto assado" a receita é o pão pronto e a
--     massa crua é desconhecida.
--   - ficha_peso_assado_kg: só quando a ficha registra perda de forno de
--     verdade (mais de 0,05 g por unidade, a mesma tolerância de
--     src/lib/recipePortions.ts) ou quando a base é "produto assado". Ficha
--     antiga grava assado = massa, e isso não é peso assado.
--   - ficha_peso_venda_kg: o peso por unidade da opção de venda em unidade do
--     mesmo produto e variante, que a tela da ficha grava e que Pedidos PJ usa
--     para converter pacote em quilo. Serve para o Forno conferir que os dois
--     contam o mesmo pão.
create function private.ficha_peso_por_unidade(
  p_product_source text,
  p_product_id text,
  p_product_variant_id uuid
)
returns table (
  ficha_massa_crua_kg numeric,
  ficha_peso_assado_kg numeric,
  ficha_peso_venda_kg numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with alvo as (
    select
      product.id as alvo_product_id,
      case
        when p_product_variant_id is not null then p_product_variant_id
        when p_product_source = 'bread' then bread.product_variant_id
        else null::uuid
      end as alvo_variant_id
    from public.products product
    left join public.breads bread
      on p_product_source = 'bread'
     and bread.id = p_product_id
    where (p_product_source = 'product' and product.id::text = p_product_id)
       or (p_product_source = 'bread' and product.legacy_bread_id = p_product_id)
    limit 1
  )
  select
    case
      when yield.basis in ('dough', 'unit') and yield.dough_weight_kg > 0
        then yield.dough_weight_kg / yield.yield_units
      else null
    end,
    case
      when yield.basis = 'baked' and yield.finished_weight_kg > 0
        then yield.finished_weight_kg / yield.yield_units
      when yield.basis = 'dough'
        and yield.dough_weight_kg > 0
        and yield.finished_weight_kg > 0
        and (yield.dough_weight_kg - yield.finished_weight_kg) / yield.yield_units > 0.00005
        then yield.finished_weight_kg / yield.yield_units
      else null
    end,
    sale_option.unit_weight_kg
  from alvo
  join public.product_recipe_yields yield
    on yield.product_id = alvo.alvo_product_id
   and yield.product_variant_id is not distinct from alvo.alvo_variant_id
  left join lateral (
    select option.unit_weight_kg
    from public.product_sale_options option
    where option.product_id = alvo.alvo_product_id
      and option.product_variant_id is not distinct from alvo.alvo_variant_id
      and option.sale_unit = 'un'
      and option.active
      and option.unit_weight_kg > 0
    order by option.is_default desc, option.updated_at desc nulls last, option.created_at desc
    limit 1
  ) sale_option on true
  where yield.yield_units > 0;
$$;

revoke all on function private.ficha_peso_por_unidade(text, text, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- c. Salário dos donos na Configuração do Sistema
-- ---------------------------------------------------------------------------

-- Rodrigo decidiu em 08/10/2026 que a retirada dele e da Suélen entra nas
-- despesas fixas do preço, como o salário de quem faz o trabalho deles, e não
-- sai do lucro. Em 04/11/2026, perguntado se o indicador usaria o valor fixo
-- ou o que foi lançado como retirada em cada mês, respondeu: "Fixo de R$ 20
-- mil". O valor mora na Configuração, mudável pelo admin, com quem mudou e
-- quando. Nada nasce preenchido (regra da Configuração desde 30/09): até o
-- admin gravar, o indicador marca o mês como provisório.
--
-- O histórico guardava só percentual (0 a 100, duas casas). O salário é em
-- reais: a coluna passa a numeric(12,2) e o limite depende da chave.
alter table private.pricing_settings_history
  drop constraint pricing_settings_history_setting_key_check,
  drop constraint pricing_settings_history_scope_check,
  drop constraint pricing_settings_history_value_check;

alter table private.pricing_settings_history
  alter column value type numeric(12, 2);

alter table private.pricing_settings_history
  add constraint pricing_settings_history_setting_key_check check (setting_key in (
    'imposto_venda',
    'taxa_canal',
    'margem_desejada',
    'margem_minima',
    'retirada_donos_mensal'
  )),
  add constraint pricing_settings_history_scope_check check (
    (setting_key in ('imposto_venda', 'retirada_donos_mensal') and channel is null and category_id is null)
    or (setting_key = 'taxa_canal' and channel is not null and category_id is null)
    or (setting_key in ('margem_desejada', 'margem_minima') and channel is not null)
  ),
  add constraint pricing_settings_history_value_check check (
    value is null
    or (setting_key = 'retirada_donos_mensal' and value between 0 and 1000000)
    or (setting_key <> 'retirada_donos_mensal' and value between 0 and 100)
  );

-- Parte da definição de 20261023180000_fechamento_caixa_protegido.sql (a
-- mesma que está em produção, conferida em 04/11/2026). Muda só: a chave nova
-- na lista, o escopo dela (vale para todos os canais) e o limite em reais.
create or replace function public.save_pricing_settings(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_name text;
  v_change_id uuid := pg_catalog.gen_random_uuid();
  v_item jsonb;
  v_key text;
  v_channel text;
  v_category_id uuid;
  v_value numeric;
  v_previous numeric;
  v_current numeric;
  v_catalog_type text;
  v_seen text[] := array[]::text[];
  v_identity text;
  v_saved integer := 0;
begin
  if not (select private.current_user_is_access_admin()) then
    raise exception using errcode = '42501',
      message = 'Somente administradores podem mudar a Configuração do Sistema.';
  end if;

  select profile.display_name into v_actor_name
    from public.app_profiles profile
   where profile.user_id = v_actor;

  if p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'array' then
    raise exception using errcode = '22023', message = 'Envie a lista de valores alterados.';
  end if;
  if pg_catalog.jsonb_array_length(p_changes) > 500 then
    raise exception using errcode = '22023', message = 'Valores demais num salvamento só.';
  end if;

  -- Um salvamento por vez: dois admins (ou dois toques) não intercalam a
  -- leitura do vigente com a gravação da versão nova. Leitura não espera.
  lock table private.pricing_settings_history in share row exclusive mode;

  for v_item in select item.value from pg_catalog.jsonb_array_elements(p_changes) as item(value) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or not (v_item ? 'setting_key' and v_item ? 'value' and v_item ? 'previous_value') then
      raise exception using errcode = '22023', message = 'Valor alterado em formato inválido.';
    end if;

    if pg_catalog.jsonb_typeof(v_item -> 'setting_key') <> 'string' then
      raise exception using errcode = '22023', message = 'Parâmetro inválido.';
    end if;
    v_key := v_item ->> 'setting_key';
    if v_key not in ('imposto_venda', 'taxa_canal', 'margem_desejada', 'margem_minima', 'retirada_donos_mensal') then
      raise exception using errcode = '22023', message = 'Parâmetro inválido.';
    end if;

    v_channel := null;
    if v_item ? 'channel' and pg_catalog.jsonb_typeof(v_item -> 'channel') <> 'null' then
      if pg_catalog.jsonb_typeof(v_item -> 'channel') <> 'string'
         or (v_item ->> 'channel') not in ('balcao', 'ifood', 'food99', 'buck') then
        raise exception using errcode = '22023', message = 'Canal inválido.';
      end if;
      v_channel := v_item ->> 'channel';
    end if;

    v_category_id := null;
    if v_item ? 'category_id' and pg_catalog.jsonb_typeof(v_item -> 'category_id') <> 'null' then
      if pg_catalog.jsonb_typeof(v_item -> 'category_id') <> 'string'
         or (v_item ->> 'category_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'Categoria inválida.';
      end if;
      v_category_id := (v_item ->> 'category_id')::uuid;
      select category.catalog_type into v_catalog_type
        from public.product_categories category
       where category.id = v_category_id;
      if v_catalog_type is null or v_catalog_type not in ('produto_fabricado', 'produto_revenda') then
        raise exception using errcode = '22023',
          message = 'A exceção de margem vale só para categoria de produto fabricado ou de revenda.';
      end if;
    end if;

    if (v_key in ('imposto_venda', 'retirada_donos_mensal') and (v_channel is not null or v_category_id is not null))
       or (v_key = 'taxa_canal' and (v_channel is null or v_category_id is not null))
       or (v_key in ('margem_desejada', 'margem_minima') and v_channel is null) then
      raise exception using errcode = '22023',
        message = 'Imposto e salário dos donos valem para todos os canais; taxa é por canal; margem é por canal, com exceção opcional por categoria.';
    end if;

    v_identity := v_key || '|' || coalesce(v_channel, '') || '|' || coalesce(v_category_id::text, '');
    if v_identity = any(v_seen) then
      raise exception using errcode = '22023', message = 'O mesmo valor veio duas vezes no salvamento.';
    end if;
    v_seen := v_seen || v_identity;

    v_value := null;
    if pg_catalog.jsonb_typeof(v_item -> 'value') = 'number' then
      v_value := (v_item ->> 'value')::numeric;
    elsif pg_catalog.jsonb_typeof(v_item -> 'value') <> 'null' then
      raise exception using errcode = '22023', message = 'Percentual deve ser número ou vazio.';
    end if;
    if v_key = 'retirada_donos_mensal' then
      if v_value is not null and (v_value < 0 or v_value > 1000000 or v_value <> pg_catalog.round(v_value, 2)) then
        raise exception using errcode = '22023',
          message = 'O salário dos donos deve ficar entre R$ 0 e R$ 1.000.000, com centavos.';
      end if;
    elsif v_value is not null and (v_value < 0 or v_value > 100 or v_value <> pg_catalog.round(v_value, 2)) then
      raise exception using errcode = '22023',
        message = 'Percentual deve ficar entre 0 e 100, com até duas casas decimais.';
    end if;

    v_previous := null;
    if pg_catalog.jsonb_typeof(v_item -> 'previous_value') = 'number' then
      v_previous := (v_item ->> 'previous_value')::numeric;
    elsif pg_catalog.jsonb_typeof(v_item -> 'previous_value') <> 'null' then
      raise exception using errcode = '22023', message = 'Valor anterior em formato inválido.';
    end if;

    select current_value.cfg_value into v_current
      from private.pricing_settings_current() current_value
     where current_value.cfg_setting_key = v_key
       and current_value.cfg_channel is not distinct from v_channel
       and current_value.cfg_category_id is not distinct from v_category_id;
    if not found then
      v_current := null;
    end if;

    if v_current is not distinct from v_value then
      continue;
    end if;
    if v_current is distinct from v_previous then
      raise exception using errcode = 'PT409',
        message = 'Outro salvamento mudou a configuração depois que a tela abriu. Recarregue a página para ver os valores atuais.';
    end if;

    insert into private.pricing_settings_history (
      setting_key, channel, category_id, value, change_id, changed_by, changed_by_name
    ) values (
      v_key, v_channel, v_category_id, v_value, v_change_id, v_actor, coalesce(v_actor_name, 'Sem nome')
    );
    v_saved := v_saved + 1;
  end loop;

  -- Margem mínima acima da desejada não faz sentido. A comparação é pelo valor
  -- que vale de fato: numa exceção de categoria, o campo vazio herda o do
  -- canal (é o que a tela promete). Assim, mínima de exceção acima da desejada
  -- do canal, ou desejada de exceção abaixo da mínima do canal, também é
  -- recusada. Confere o estado final inteiro, não só o que veio agora.
  if exists (
    with vigente as (
      select * from private.pricing_settings_current()
    ),
    escopo as (
      select canal.channel, null::uuid as category_id
        from pg_catalog.unnest(array['balcao', 'ifood', 'food99', 'buck']) as canal(channel)
      union
      select vigente.cfg_channel, vigente.cfg_category_id
        from vigente
       where vigente.cfg_category_id is not null
    ),
    efetivo as (
      select
        coalesce(
          (select vigente.cfg_value from vigente
            where vigente.cfg_setting_key = 'margem_desejada' and vigente.cfg_channel = escopo.channel
              and vigente.cfg_category_id is not distinct from escopo.category_id),
          (select vigente.cfg_value from vigente
            where vigente.cfg_setting_key = 'margem_desejada' and vigente.cfg_channel = escopo.channel
              and vigente.cfg_category_id is null)
        ) as desired,
        coalesce(
          (select vigente.cfg_value from vigente
            where vigente.cfg_setting_key = 'margem_minima' and vigente.cfg_channel = escopo.channel
              and vigente.cfg_category_id is not distinct from escopo.category_id),
          (select vigente.cfg_value from vigente
            where vigente.cfg_setting_key = 'margem_minima' and vigente.cfg_channel = escopo.channel
              and vigente.cfg_category_id is null)
        ) as minimum
      from escopo
    )
    select 1 from efetivo
     where efetivo.minimum is not null
       and efetivo.desired is not null
       and efetivo.minimum > efetivo.desired
  ) then
    raise exception using errcode = '22023',
      message = 'A margem mínima não pode ser maior que a margem desejada que vale para o mesmo canal e categoria (campo vazio na exceção usa o valor do canal).';
  end if;

  return pg_catalog.jsonb_build_object(
    'change_id', case when v_saved > 0 then v_change_id end,
    'saved', v_saved
  );
end;
$$;
revoke all on function public.save_pricing_settings(jsonb) from public, anon, service_role;
grant execute on function public.save_pricing_settings(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- d. Indicador: quilos de massa crua pela ficha e salário dos donos
-- ---------------------------------------------------------------------------

-- Parte da definição de 20260930013002_indicadores_preco_financeiro.sql (a
-- mesma que está em produção, conferida em 04/11/2026). Muda duas coisas.
-- Despesas fixas: somam o salário dos donos da Configuração em todo mês, e o
-- mês sem ele definido fica provisório. Bloco "production": cada lançamento da produção vale quantidade × massa
-- crua por unidade da ficha. Produção lançada em quilo é pão pronto: conta só
-- quando a ficha tem massa crua e peso assado, levada à massa crua pela razão
-- entre os dois; sem essa razão fica fora da cobertura, em vez de passar o
-- quilo assado por quilo de massa. O resto da conta é o mesmo.
create or replace function private.pricing_financial_indicators_report(p_today date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      date '2026-09-01' as first_month,
      date_trunc('month', coalesce(p_today, private.data_na_padaria()))::date as current_month
  ),
  -- Salário dos donos: o valor vigente da Configuração vale para todos os
  -- meses. É o quanto o preço precisa cobrir, não o que foi retirado em cada
  -- mês (decisão de 04/11/2026). Nulo: não definido, e o mês fica provisório.
  owner_salary as (
    select (
      select current_value.cfg_value
      from private.pricing_settings_current() current_value
      where current_value.cfg_setting_key = 'retirada_donos_mensal'
        and current_value.cfg_channel is null
        and current_value.cfg_category_id is null
    ) as monthly_value
  ),
  months as (
    select generate_series(
      bounds.first_month,
      bounds.current_month - interval '1 month',
      interval '1 month'
    )::date as month_start
    from bounds
    where bounds.current_month > bounds.first_month
  ),
  finance as (
    select
      entry.competence_month as month_start,
      sum(entry.amount) filter (where category.key in ('clientes_pj', 'buck_ex')) as pj_buck_revenue,
      sum(entry.amount) filter (
        where category.nature = 'despesa'
          and category.dre_tier = 'operacional'
          and category.dre_group in ('mao_de_obra', 'ocupacao', 'manutencao', 'servicos', 'financeiras', 'outras')
          and category.key <> 'mao_obra_producao'
      ) as fixed_expenses,
      sum(entry.amount) filter (where category.key = 'mao_obra_producao') as production_labor,
      bool_or(category.key in ('mao_obra_encargos', 'mao_obra_diarias')) as has_unassigned_labor
    from public.finance_entries entry
    join public.finance_categories category on category.id = entry.category_id
    where entry.competence_month >= (select first_month from bounds)
      and entry.competence_month < (select current_month from bounds)
      and entry.entry_type = 'lancamento'
      and entry.reversed_at is null
      and (
        category.key in ('clientes_pj', 'buck_ex', 'mao_obra_producao')
        or (
          category.nature = 'despesa'
          and category.dre_tier = 'operacional'
          and category.dre_group in ('mao_de_obra', 'ocupacao', 'manutencao', 'servicos', 'financeiras', 'outras')
          and category.key <> 'mao_obra_producao'
        )
      )
    group by entry.competence_month
  ),
  cash_sales as (
    select
      date_trunc('month', closing.closing_date)::date as month_start,
      sum(closing.sales_amount) as counter_sales,
      sum(closing.ifood_sales_amount) as ifood_sales
    from public.cash_closings closing
    where closing.store in ('jc', 'ja')
      and closing.closing_date >= (select first_month from bounds)
      and closing.closing_date < (select current_month from bounds)
    group by date_trunc('month', closing.closing_date)::date
  ),
  production as (
    select
      date_trunc('month', actual.record_date)::date as month_start,
      sum(actual.quantity_baked) as production_quantity,
      sum(case
        when lower(actual.production_unit) = 'kg'
          then case when ficha.ficha_massa_crua_kg > 0 and ficha.ficha_peso_assado_kg > 0
            then actual.quantity_baked else 0 end
        when ficha.ficha_massa_crua_kg > 0 then actual.quantity_baked
        else 0
      end) as quantity_with_known_weight,
      sum(case
        when lower(actual.production_unit) = 'kg'
          then case when ficha.ficha_massa_crua_kg > 0 and ficha.ficha_peso_assado_kg > 0
            then actual.quantity_baked * ficha.ficha_massa_crua_kg / ficha.ficha_peso_assado_kg else 0 end
        when ficha.ficha_massa_crua_kg > 0 then actual.quantity_baked * ficha.ficha_massa_crua_kg
        else 0
      end) as kilograms_with_known_weight
    from public.production_actuals actual
    left join lateral private.ficha_peso_por_unidade(
      actual.product_source,
      actual.product_id,
      actual.product_variant_id
    ) ficha on true
    where actual.record_date >= (select first_month from bounds)
      and actual.record_date < (select current_month from bounds)
      and actual.product_source in ('bread', 'product')
    group by date_trunc('month', actual.record_date)::date
  ),
  expected_closings as (
    select
      months.month_start,
      stores.store,
      count(*) filter (where closing.id is null)::integer as missing_days
    from months
    cross join (values ('jc'::text), ('ja'::text)) stores(store)
    cross join lateral generate_series(
      months.month_start,
      (months.month_start + interval '1 month - 1 day')::date,
      interval '1 day'
    ) day(day_date)
    left join public.cash_closings closing
      on closing.store = stores.store
     and closing.closing_date = day.day_date::date
    where stores.store <> 'jc' or extract(dow from day.day_date) <> 0
    group by months.month_start, stores.store
  ),
  monthly_base as (
    select
      months.month_start,
      coalesce(cash.counter_sales, 0) as counter_sales,
      coalesce(cash.ifood_sales, 0) as ifood_sales,
      coalesce(finance.pj_buck_revenue, 0) as pj_buck_revenue,
      coalesce(cash.counter_sales, 0) + coalesce(cash.ifood_sales, 0)
        + coalesce(finance.pj_buck_revenue, 0) as revenue,
      coalesce(finance.fixed_expenses, 0) + coalesce(owner_salary.monthly_value, 0) as fixed_expenses,
      owner_salary.monthly_value as owner_salary,
      coalesce(finance.production_labor, 0) as production_labor,
      coalesce(production.production_quantity, 0) as production_quantity,
      coalesce(production.quantity_with_known_weight, 0) as quantity_with_known_weight,
      coalesce(production.kilograms_with_known_weight, 0) as kilograms_with_known_weight,
      coalesce(finance.has_unassigned_labor, false) as has_unassigned_labor,
      coalesce(closings.jc_missing, 0) as jc_missing,
      coalesce(closings.ja_missing, 0) as ja_missing
    from months
    cross join owner_salary
    left join finance on finance.month_start = months.month_start
    left join cash_sales cash on cash.month_start = months.month_start
    left join production on production.month_start = months.month_start
    left join lateral (
      select
        sum(missing_days) filter (where store = 'jc')::integer as jc_missing,
        sum(missing_days) filter (where store = 'ja')::integer as ja_missing
      from expected_closings expected
      where expected.month_start = months.month_start
    ) closings on true
  ),
  monthly_values as (
    select
      monthly_base.*,
      case when revenue > 0 then fixed_expenses / revenue else null end as fixed_expense_pct,
      case when production_quantity > 0 then quantity_with_known_weight / production_quantity else 0 end as weight_coverage,
      case when kilograms_with_known_weight > 0 then production_labor / kilograms_with_known_weight else null end as labor_cost_per_kg
    from monthly_base
  ),
  monthly_reasons as (
    select
      metric.*,
      array_remove(array[
        case when weight_coverage < 0.9 then 'cobertura de peso ' || round(weight_coverage * 100)::text || '%' end,
        case when jc_missing > 0 then 'mês sem fechamento de caixa da JC em ' || jc_missing::text || case when jc_missing = 1 then ' dia' else ' dias' end end,
        case when ja_missing > 0 then 'mês sem fechamento de caixa da JA em ' || ja_missing::text || case when ja_missing = 1 then ' dia' else ' dias' end end,
        case when has_unassigned_labor then 'encargos e diárias sem equipe' end,
        case when owner_salary is null then 'salário dos donos não definido na Configuração' end,
        case when revenue <= 0 then 'sem faturamento para calcular despesas fixas' end,
        case when kilograms_with_known_weight <= 0 then 'sem quilos produzidos com peso conhecido' end
      ], null) as provisional_reasons
    from monthly_values metric
  ),
  average_reasons as (
    select coalesce(array_agg(distinct reason order by reason) filter (where reason is not null), array[]::text[]) as reasons
    from monthly_reasons
    left join lateral unnest(provisional_reasons) as listed_reasons(reason) on true
  ),
  result_months as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'month', to_char(month_start, 'YYYY-MM'),
      'counter_sales', counter_sales,
      'ifood_sales', ifood_sales,
      'pj_buck_revenue', pj_buck_revenue,
      'revenue', revenue,
      'fixed_expenses', fixed_expenses,
      'fixed_expense_pct', fixed_expense_pct,
      'owner_salary', owner_salary,
      'production_labor', production_labor,
      'kilograms_with_known_weight', kilograms_with_known_weight,
      'production_quantity', production_quantity,
      'quantity_with_known_weight', quantity_with_known_weight,
      'weight_coverage_pct', weight_coverage * 100,
      'labor_cost_per_kg', labor_cost_per_kg,
      'is_provisional', cardinality(provisional_reasons) > 0,
      'provisional_reasons', to_jsonb(provisional_reasons)
    ) order by month_start), '[]'::jsonb) as rows
    from monthly_reasons
  ),
  averages as (
    select
      count(*)::integer as month_count,
      sum(revenue) as revenue_total,
      sum(fixed_expenses) as fixed_expenses_total,
      sum(production_labor) as production_labor_total,
      sum(kilograms_with_known_weight) as kilograms_total,
      sum(production_quantity) as production_quantity_total,
      sum(quantity_with_known_weight) as quantity_with_weight_total,
      bool_or(cardinality(provisional_reasons) > 0) as is_provisional
    from monthly_reasons
  )
  select jsonb_build_object(
    'months', result_months.rows,
    'average', case when averages.month_count = 0 then null else jsonb_build_object(
      'months_included', (select jsonb_agg(value->>'month' order by value->>'month') from jsonb_array_elements(result_months.rows) value),
      'month_count', averages.month_count,
      'revenue', averages.revenue_total / averages.month_count,
      'fixed_expenses', averages.fixed_expenses_total / averages.month_count,
      'fixed_expense_pct', case when averages.revenue_total > 0 then averages.fixed_expenses_total / averages.revenue_total else null end,
      'owner_salary', (select owner_salary.monthly_value from owner_salary),
      'production_labor', averages.production_labor_total / averages.month_count,
      'kilograms_with_known_weight', averages.kilograms_total / averages.month_count,
      'production_quantity', averages.production_quantity_total / averages.month_count,
      'quantity_with_known_weight', averages.quantity_with_weight_total / averages.month_count,
      'weight_coverage_pct', case when averages.production_quantity_total > 0 then averages.quantity_with_weight_total / averages.production_quantity_total * 100 else 0 end,
      'labor_cost_per_kg', case when averages.kilograms_total > 0 then averages.production_labor_total / averages.kilograms_total else null end,
      'is_provisional', coalesce(averages.is_provisional, false),
      'provisional_reasons', to_jsonb(average_reasons.reasons)
    ) end
  )
  from result_months
  cross join averages
  cross join average_reasons;
$$;

revoke all on function private.pricing_financial_indicators_report(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- e. Forno: pedido PJ por quilo convertido pelo peso assado da ficha
-- ---------------------------------------------------------------------------

-- Parte da definição de 20260916052614_pedidos_producao_variantes_pacotes.sql
-- (a mesma que está em produção, conferida em 04/11/2026). Mesma assinatura e mesmas linhas devolvidas; muda de onde vem o peso e onde
-- a conta acontece. Antes, as linhas de um mesmo pão eram somadas e o total em
-- quilo dividido por um peso só, o do cadastro de pães, mesmo quando o pedido
-- era de outra variante. Agora cada linha da programação é convertida pelo
-- peso assado da própria ficha (produto e variante) e as peças é que somam.
-- Linha em quilo sem peso assado na ficha fica fora da soma e acende o aviso.
-- Também acende quando a opção de venda em unidade do mesmo produto e variante
-- tem outro peso: Pedidos PJ fecha o pacote em quilo por ela, e o Forno não
-- pode prever outro número de peças em silêncio. Salvar a ficha iguala os dois.
create or replace function public.list_pj_production_for_oven_v2(p_production_date date)
returns table (
  product_source text,
  product_id text,
  product_variant_id uuid,
  product_name text,
  production_unit text,
  quantity numeric,
  needs_weight_setup boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    private.current_user_can_plan_pj_production()
    or private.current_user_has_permission('forno.acessar', 'jc')
  ) then
    raise exception using errcode = '42501', message = 'Usuario sem permissao para consultar a producao PJ.';
  end if;
  if p_production_date is null then
    raise exception using errcode = '22004', message = 'Informe a data de producao.';
  end if;

  return query
  with schedule_rows as (
    select
      case when schedule.bread_id is not null then 'bread' else schedule.product_source end as row_source,
      coalesce(schedule.bread_id, schedule.product_id) as row_id,
      case when schedule.bread_id is not null then null::uuid else schedule.product_variant_id end as row_variant_id,
      coalesce(bread.name, schedule.product_name) as row_name,
      case
        when schedule.bread_id is not null then coalesce(bread.unit, 'un')
        when unit_option.id is not null then 'un'
        else coalesce(schedule.production_unit, 'un')
      end as target_unit,
      case
        when ficha.ficha_peso_assado_kg > 0
          and (ficha.ficha_peso_venda_kg is null
            or abs(ficha.ficha_peso_venda_kg - ficha.ficha_peso_assado_kg) <= 0.0000005)
          then ficha.ficha_peso_assado_kg
        else null
      end as baked_unit_weight_kg,
      schedule.production_unit as row_unit,
      (schedule.scheduled_quantity - schedule.frozen_quantity) as pending_quantity
    from public.pj_production_schedules schedule
    join public.orders order_row on order_row.id = schedule.order_id
    left join public.breads bread on bread.id = schedule.bread_id
    left join public.product_sale_options unit_option
      on schedule.bread_id is null
     and schedule.product_source = 'product'
     and unit_option.product_id::text = schedule.product_id
     and unit_option.product_variant_id is not distinct from schedule.product_variant_id
     and unit_option.sale_unit = 'un'
     and unit_option.active
    left join lateral private.ficha_peso_por_unidade(
      case when schedule.bread_id is not null then 'bread' else schedule.product_source end,
      coalesce(schedule.bread_id, schedule.product_id),
      schedule.product_variant_id
    ) ficha on true
    where schedule.production_date = p_production_date
      and order_row.cancelled_at is null
      and schedule.production_process = 'forno'
      and schedule.scheduled_quantity > schedule.frozen_quantity
  ),
  aggregated as (
    select
      schedule_rows.row_source,
      schedule_rows.row_id,
      schedule_rows.row_variant_id,
      max(schedule_rows.row_name) as row_name,
      max(schedule_rows.target_unit) as target_unit,
      sum(schedule_rows.pending_quantity) filter (
        where not (schedule_rows.row_unit = 'kg' and schedule_rows.target_unit <> 'kg')
      ) as native_quantity,
      sum(schedule_rows.pending_quantity / schedule_rows.baked_unit_weight_kg) filter (
        where schedule_rows.row_unit = 'kg' and schedule_rows.target_unit <> 'kg'
          and schedule_rows.baked_unit_weight_kg > 0
      ) as converted_pieces,
      bool_or(
        schedule_rows.row_unit = 'kg' and schedule_rows.target_unit <> 'kg'
        and schedule_rows.pending_quantity > 0
        and not coalesce(schedule_rows.baked_unit_weight_kg > 0, false)
      ) as missing_weight
    from schedule_rows
    group by schedule_rows.row_source, schedule_rows.row_id, schedule_rows.row_variant_id
  )
  select
    aggregated.row_source,
    aggregated.row_id,
    aggregated.row_variant_id,
    aggregated.row_name,
    aggregated.target_unit,
    coalesce(aggregated.native_quantity, 0) + coalesce(round(aggregated.converted_pieces), 0),
    coalesce(aggregated.missing_weight, false)
  from aggregated
  order by aggregated.row_name, aggregated.row_id, aggregated.row_variant_id;
end;
$$;

revoke all on function public.list_pj_production_for_oven_v2(date)
  from public, anon, authenticated;
grant execute on function public.list_pj_production_for_oven_v2(date)
  to authenticated, service_role;

commit;
