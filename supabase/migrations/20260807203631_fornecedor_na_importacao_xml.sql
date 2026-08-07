-- Cadastra o emitente do XML sem abandonar a importacao da NF-e.
create or replace function public.create_payable_supplier(
  p_name text,
  p_cnpj text
)
returns table (
  id uuid,
  name text,
  cnpj text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cnpj text := nullif(regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g'), '');
  v_supplier public.suppliers%rowtype;
begin
  if not private.current_user_can_payables('contas_pagar.importar_xml') then
    raise exception using errcode = '42501', message = 'Sem permissao para cadastrar fornecedor nesta importacao.';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception using errcode = '22023', message = 'Nome do fornecedor e obrigatorio.';
  end if;

  if v_cnpj is not null and length(v_cnpj) not in (11, 14) then
    raise exception using errcode = '22023', message = 'CNPJ ou CPF do fornecedor e invalido.';
  end if;

  if v_cnpj is not null then
    select supplier.*
      into v_supplier
    from public.suppliers supplier
    where regexp_replace(coalesce(supplier.cnpj, ''), '[^0-9]', '', 'g') = v_cnpj
    order by supplier.active desc, supplier.created_at
    limit 1;

    if v_supplier.id is not null then
      if not coalesce(v_supplier.active, false) then
        raise exception using errcode = '22023', message = 'Ja existe um fornecedor inativo com este CNPJ. Reative-o no cadastro de fornecedores.';
      end if;
      return query select v_supplier.id, v_supplier.name, v_supplier.cnpj;
      return;
    end if;
  end if;

  insert into public.suppliers (name, cnpj, active)
  values (trim(p_name), nullif(trim(p_cnpj), ''), true)
  returning suppliers.* into v_supplier;

  return query select v_supplier.id, v_supplier.name, v_supplier.cnpj;
end;
$$;

revoke all on function public.create_payable_supplier(text, text) from public;
revoke all on function public.create_payable_supplier(text, text) from anon;
grant execute on function public.create_payable_supplier(text, text) to authenticated;
