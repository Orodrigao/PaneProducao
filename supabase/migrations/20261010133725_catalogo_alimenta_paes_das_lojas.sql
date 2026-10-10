-- O catálogo passa a ser a única porta de cadastro dos pães das lojas.
--
-- Planejamento da produção, pedido das lojas (tela inicial), a parte das lojas
-- no Forno e a busca do Romaneio leem a lista antiga de pães (public.breads).
-- Desde 26/08/2026 todo pão novo entrou só pelo catálogo (public.products) e
-- nunca chegou a essas telas: o "LA Rustico", cadastrado em 25/09 para sábado,
-- não aparecia para montar a produção nem para pôr no romaneio (relato do
-- Rodrigo, 10/10/2026). Os dias marcados no catálogo também não comandavam
-- nada, e quatro pães já estavam com dias diferentes nos dois cadastros.
--
-- Daqui em diante:
--   * products.is_loja ("Lojas" no cadastro) diz que o produto vai para as
--     lojas: Planejamento, pedido das lojas, Forno e Romaneio;
--   * marcar Lojas num produto sem pão ligado cria o pão e liga os dois
--     (products.legacy_bread_id);
--   * nome, dias de produção e ativo descem do produto para o pão ligado, só
--     quando mudam. O nome curto que a equipe usa hoje ("B.Brasil") fica até
--     alguém renomear o produto;
--   * o pão fica ativo enquanto o produto estiver ativo e marcado Lojas;
--   * item PJ antigo (breads.is_pj) não é tocado, e não pode ser marcado Lojas.
-- Unidade, peso médio, prateleira e custo do pão continuam sendo do pão.

alter table public.products
  add column is_loja boolean not null default false;

comment on column public.products.is_loja is
  'Vai para as lojas (Planejamento, pedido das lojas, Forno e Romaneio). Marcado, o produto mantém um pão ligado em public.breads, criado e sincronizado por private.sincronizar_pao_das_lojas.';

create function private.sincronizar_pao_das_lojas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pao_id text;
  v_pao_pj boolean;
begin
  if new.legacy_bread_id is null then
    if not new.is_loja then
      return new;
    end if;

    -- Identificador próprio, derivado do produto: não colide com os pães
    -- antigos ("italiano1775678213582") nem se repete entre produtos.
    v_pao_id := 'catalogo_' || replace(new.id::text, '-', '');

    insert into public.breads (id, name, days, active, is_pj, unit)
    values (
      v_pao_id,
      btrim(new.name),
      new.production_days,
      new.active is distinct from false,
      false,
      case when lower(btrim(coalesce(new.unit, ''))) in ('kg', 'kilo', 'quilo') then 'kg' else 'un' end
    )
    on conflict (id) do update set
      name = excluded.name,
      days = excluded.days,
      active = excluded.active,
      is_pj = false;

    new.legacy_bread_id := v_pao_id;
    return new;
  end if;

  -- Produto que já nasce ligado (seed, carga manual) não reescreve o pão.
  if tg_op = 'INSERT' then
    return new;
  end if;

  -- A tela reenvia nome, dias e ativo em todo salvamento; sem mudança real,
  -- o pão não é tocado.
  if new.name is not distinct from old.name
    and new.production_days is not distinct from old.production_days
    and new.active is not distinct from old.active
    and new.is_loja is not distinct from old.is_loja
  then
    return new;
  end if;

  select bread.is_pj
    into v_pao_pj
  from public.breads bread
  where bread.id = new.legacy_bread_id;

  if not found then
    if new.is_loja then
      raise exception 'O pão ligado a "%" não existe mais. Avise o administrador antes de marcar Lojas.', new.name
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if v_pao_pj then
    if new.is_loja then
      raise exception '"%" está ligado a um item PJ antigo e não pode ser marcado Lojas.', new.name
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  update public.breads bread
  set
    name = case
      when new.name is distinct from old.name then btrim(new.name)
      else bread.name
    end,
    days = case
      when new.production_days is distinct from old.production_days then new.production_days
      else bread.days
    end,
    active = case
      when new.active is distinct from old.active or new.is_loja is distinct from old.is_loja
        then (new.active is distinct from false) and new.is_loja
      else bread.active
    end
  where bread.id = new.legacy_bread_id;

  return new;
end;
$$;

revoke all on function private.sincronizar_pao_das_lojas()
  from public, anon, authenticated, service_role;

create trigger sincronizar_pao_das_lojas_antes_de_gravar_produto
before insert or update of name, production_days, active, is_loja
on public.products
for each row execute function private.sincronizar_pao_das_lojas();

-- ---------------------------------------------------------------------------
-- Correções decididas pelo Rodrigo em 10/10/2026. Cada uma confere o estado de
-- produção antes de agir; nos bancos de teste não encontra nada e não faz nada.
-- ---------------------------------------------------------------------------

-- Pães antigos que eram o mesmo pão de um produto do catálogo, sem ligação.
-- Sem isto, marcar Lojas nesses produtos criaria um segundo pão igual.
update public.products product
set legacy_bread_id = 'pao_originale_mora1787723771684'
where product.id = 'a72ab703-1fc0-47e0-a82a-ea04280b120e'
  and product.name = 'Pão Originale (Mora)'
  and product.legacy_bread_id is null
  and exists (
    select 1 from public.breads bread
    where bread.id = 'pao_originale_mora1787723771684'
      and bread.name = 'Pão Originale (Mora)'
      and not bread.is_pj
  )
  and not exists (
    select 1 from public.products other
    where other.legacy_bread_id = 'pao_originale_mora1787723771684'
  );

update public.products product
set legacy_bread_id = 'pao_de_nozez1783037673222'
where product.id = '13ceeab0-49d0-4700-aa4d-5015431526c8'
  and product.name = 'Pão de Nozes'
  and product.legacy_bread_id is null
  and exists (
    select 1 from public.breads bread
    where bread.id = 'pao_de_nozez1783037673222'
      and bread.name = 'Pão de Nozez'
      and not bread.is_pj
  )
  and not exists (
    select 1 from public.products other
    where other.legacy_bread_id = 'pao_de_nozez1783037673222'
  );

-- O nome do pão antigo tinha erro de digitação; o dia (sábado) é o que a
-- produção já usa e passa a valer também no catálogo.
update public.breads bread
set name = 'Pão de Nozes'
where bread.id = 'pao_de_nozez1783037673222'
  and bread.name = 'Pão de Nozez'
  and exists (
    select 1 from public.products product
    where product.id = '13ceeab0-49d0-4700-aa4d-5015431526c8'
      and product.legacy_bread_id = bread.id
  );

update public.products product
set production_days = '{6}'
where product.id = '13ceeab0-49d0-4700-aa4d-5015431526c8'
  and product.legacy_bread_id = 'pao_de_nozez1783037673222'
  and product.production_days = '{}'::integer[];

-- Dias certos, conforme o Rodrigo: Grand Arome na quarta, Tapioca na terça.
-- A produção já usava esses dias; o catálogo estava trocado.
update public.products product
set production_days = '{3}'
where product.id = '3e47332b-8be2-42c8-8106-57f5a06ee041'
  and product.legacy_bread_id = 'grande_arome1775678443844'
  and product.production_days = '{2}'::integer[];

update public.products product
set production_days = '{2}'
where product.id = '427aa1d5-874e-45ed-92d8-9de8fb0b6e48'
  and product.legacy_bread_id = 'pao_de_tapioca1778572678568'
  and product.production_days = '{3}'::integer[];

-- O "Pão de Hotdog" saiu de linha e foi substituído pelo Pão de Cachorro
-- Quente, que já usava este mesmo pão na produção. O pão passa a ter o nome e
-- os dias do produto atual (segunda a sábado; não houve entrega de domingo
-- desde julho).
update public.breads bread
set name = 'Pão de Cachorro Quente',
    days = '{1,2,3,4,5,6}'
where bread.id = 'paodehotdog1779743021606'
  and bread.name = 'Pão de Hotdog'
  and not bread.is_pj
  and exists (
    select 1 from public.products product
    where product.id = '888f9a70-ff75-45eb-b5fc-add486dc287c'
      and product.legacy_bread_id = bread.id
      and product.name = 'Pão de Cachorro Quente'
      and product.production_days = '{1,2,3,4,5,6}'::integer[]
  );

-- O Pão de Abóbora saiu de linha. O produto já está inativo; o item PJ antigo
-- ligado a ele continuava ativo.
update public.breads bread
set active = false
where bread.id = 'paodeaboborabaguetinha1779892520050'
  and bread.is_pj
  and bread.active
  and exists (
    select 1 from public.products product
    where product.id = 'ab742bbc-3ade-4176-905b-61f27ff940c8'
      and product.legacy_bread_id = bread.id
      and product.active = false
  );

-- ---------------------------------------------------------------------------
-- Marca Lojas. Regras gerais, sem depender de identificador de produção.
-- ---------------------------------------------------------------------------

-- Produto já ligado a pão das lojas: vai para as lojas, exceto o que está ativo
-- no catálogo e fora da produção (sazonal, como a Cuca de Morango). Quem está
-- inativo no catálogo fica marcado e volta à produção se for reativado. O
-- gatilho acima recalcula o ativo do pão: o Pão de Sopa, inativo no catálogo,
-- sai do Planejamento.
update public.products product
set is_loja = true
from public.breads bread
where bread.id = product.legacy_bread_id
  and not bread.is_pj
  and (bread.active or product.active = false)
  and product.is_fabricacao_propria
  and product.kind = 'final'
  and coalesce(product.production_process, 'forno') = 'forno';

-- Pão de forno das lojas cadastrado só no catálogo: ganha o pão que faltava.
-- Em produção, 10/10/2026: LA Rustico, Croissant romeu e julieta, Bolo de Fubá
-- Romeu e Julieta e Focaccia de Tomate. Produto PJ fica de fora, porque "PJ" no
-- catálogo não diz se ele também vai para as lojas; quem decide é a marcação.
update public.products product
set is_loja = true
where product.legacy_bread_id is null
  and product.is_fabricacao_propria
  and product.kind = 'final'
  and product.production_process = 'forno'
  and not product.is_pj
  and product.active is distinct from false;

alter table public.products
  add constraint products_is_loja_requer_pao_de_forno
  check (
    not is_loja
    or (
      is_fabricacao_propria
      and coalesce(kind, '') = 'final'
      and coalesce(production_process, 'forno') = 'forno'
    )
  );
