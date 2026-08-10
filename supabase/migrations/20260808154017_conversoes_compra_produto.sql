begin;

drop policy if exists payable_product_mappings_select_finance
on public.payable_product_mappings;

create policy payable_product_mappings_select_catalog_managers
on public.payable_product_mappings for select to authenticated
using (
  private.current_user_can_payables('contas_pagar.acessar')
  or exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role in ('admin', 'financeiro')
      and coalesce(profile.allowed_routes, '[]'::jsonb) ? '/produtos'
  )
);

create or replace function public.update_payable_product_mappings(
  p_product_id uuid,
  p_mappings jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mapping record;
begin
  if not exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role in ('admin', 'financeiro')
      and coalesce(profile.allowed_routes, '[]'::jsonb) ? '/produtos'
  ) then
    raise exception using errcode = '42501', message = 'Sem permissão para corrigir conversões de compra.';
  end if;

  if p_product_id is null
     or not exists (select 1 from public.products product where product.id = p_product_id) then
    raise exception using errcode = '22023', message = 'Produto-base inválido.';
  end if;
  if jsonb_typeof(coalesce(p_mappings, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'Lista de conversões inválida.';
  end if;

  for v_mapping in
    select * from jsonb_to_recordset(coalesce(p_mappings, '[]'::jsonb)) as item(
      id uuid,
      conversion_basis text,
      conversion_factor numeric
    )
  loop
    if v_mapping.id is null
       or v_mapping.conversion_basis not in ('simple', 'package', 'usable')
       or v_mapping.conversion_factor is null
       or v_mapping.conversion_factor <= 0 then
      raise exception using errcode = '22023', message = 'Fator de conversão inválido.';
    end if;

    update public.payable_product_mappings mapping
    set conversion_basis = v_mapping.conversion_basis,
        conversion_factor = v_mapping.conversion_factor,
        last_confirmed_at = now(),
        last_confirmed_by = (select auth.uid()),
        updated_at = now()
    where mapping.id = v_mapping.id
      and mapping.base_product_id = p_product_id
      and mapping.active;

    if not found then
      raise exception using errcode = '22023', message = 'Conversão não pertence ao produto informado.';
    end if;
  end loop;
end;
$$;

revoke all on function public.update_payable_product_mappings(uuid, jsonb) from public;
grant execute on function public.update_payable_product_mappings(uuid, jsonb) to authenticated;

commit;
