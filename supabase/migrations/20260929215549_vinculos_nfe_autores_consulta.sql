-- Expose only the names of authors tied to records this product screen can show.
-- app_profiles deliberately allows users to read only their own profile; this
-- narrow RPC avoids broadening that table's RLS for the Financeiro profile.
create or replace function public.list_vinculo_nfe_authors(p_product_id uuid)
returns table (author_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_product_id is null then
    raise exception using errcode = '22023', message = 'Produto obrigatório.';
  end if;

  if not exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and (
        profile.role = 'admin'
        or (
          profile.role = 'financeiro'
          and coalesce(profile.allowed_routes, '[]'::jsonb) ?| array['/produtos', '*']
          and private.current_user_can_payables('contas_pagar.acessar')
        )
      )
  ) then
    raise exception using errcode = '42501', message = 'Sem permissão para consultar autores dos vínculos.';
  end if;

  return query
  select profile.user_id, profile.display_name
  from public.app_profiles profile
  where profile.user_id in (
    select mapping.last_confirmed_by
    from public.payable_product_mappings mapping
    where mapping.base_product_id = p_product_id

    union

    select item.mapping_confirmed_by
    from public.payable_purchase_items item
    join public.payable_purchases purchase on purchase.id = item.purchase_id
    where item.product_id = p_product_id
      and purchase.origin = 'xml'
      and purchase.store = 'jc'

    union

    select item.factor_confirmed_by
    from public.payable_purchase_items item
    join public.payable_purchases purchase on purchase.id = item.purchase_id
    where item.product_id = p_product_id
      and purchase.origin = 'xml'
      and purchase.store = 'jc'
  )
  order by profile.display_name;
end;
$$;

revoke all on function public.list_vinculo_nfe_authors(uuid) from public, anon, authenticated;
grant execute on function public.list_vinculo_nfe_authors(uuid) to authenticated;
