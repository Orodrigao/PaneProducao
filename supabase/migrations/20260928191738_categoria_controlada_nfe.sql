-- O cadastro rápido da NF-e passa a gravar a mesma categoria controlada da
-- tela Produtos. A assinatura antiga continua disponível durante a troca do
-- site, mas também passa a resolver uma categoria existente e ativa.
create or replace function public.create_payable_catalog_product(
  p_name text,
  p_category text,
  p_unit text,
  p_category_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.product_categories%rowtype;
  v_product_id uuid;
begin
  if not private.current_user_can_payables('contas_pagar.lancar') then
    raise exception using errcode = '42501', message = 'Sem permissão para cadastrar item nesta importação.';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_unit), '') is null then
    raise exception using errcode = '22023', message = 'Nome e unidade do novo item são obrigatórios.';
  end if;

  select * into v_category
  from public.product_categories category
  where category.id = p_category_id
    and category.active
    and category.catalog_type in ('materia_prima', 'produto_revenda');
  if not found or private.normalize_product_category_name(p_category) is distinct from v_category.normalized_name then
    raise exception using errcode = '22023', message = 'Escolha uma categoria válida e ativa para o item da NF-e.';
  end if;

  -- Duas notas que cadastram o mesmo nome ao mesmo tempo esperam uma pela
  -- outra. O segundo cadastro vê o primeiro antes de tentar inserir.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('create_payable_catalog_product'),
    pg_catalog.hashtext(lower(trim(p_name)))
  );
  select product.id into v_product_id
  from public.products product
  where product.active and lower(trim(product.name)) = lower(trim(p_name))
  order by product.created_at
  limit 1;
  if v_product_id is not null then
    raise exception using errcode = '23505', message = 'Já existe um item ativo com esse nome. Selecione o cadastro existente na NF-e.';
  end if;

  insert into public.products (
    name, category, category_id, catalog_type, active, unit, kind,
    is_revenda, is_fabricacao_propria, production_area
  ) values (
    trim(p_name), v_category.name, v_category.id, v_category.catalog_type,
    true, trim(p_unit),
    case when v_category.catalog_type = 'produto_revenda' then 'final' else 'insumo' end,
    v_category.catalog_type = 'produto_revenda', false, 'outros'
  ) returning id into v_product_id;
  return v_product_id;
end;
$$;

create or replace function public.create_payable_catalog_product(
  p_name text,
  p_category text,
  p_unit text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_id uuid;
begin
  select category.id into v_category_id
  from public.product_categories category
  where category.active
    and category.catalog_type in ('materia_prima', 'produto_revenda')
    and category.normalized_name = private.normalize_product_category_name(coalesce(nullif(trim(p_category), ''), 'Insumos'));
  if v_category_id is null then
    raise exception using errcode = '22023', message = 'A categoria informada não existe no cadastro controlado.';
  end if;
  return public.create_payable_catalog_product(p_name, coalesce(nullif(trim(p_category), ''), 'Insumos'), p_unit, v_category_id);
end;
$$;

revoke all on function public.create_payable_catalog_product(text, text, text, uuid) from public;
grant execute on function public.create_payable_catalog_product(text, text, text, uuid) to authenticated;
