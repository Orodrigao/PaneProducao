-- Conversões de compra do Catálogo: mesma regra de quem corrige memória de
-- vínculo de NF-e (01/10/2026).
--
-- public.update_payable_product_mappings gravava fator e base da memória do
-- fornecedor para qualquer Administrador ou Financeiro com a rota /produtos,
-- sem exigir o Contas a pagar da JC que a correção da fase 3 exige
-- (private.pode_corrigir_vinculos_nfe, decisão do Rodrigo em 28/09 e
-- 01/10/2026). A tela Produtos deixa de chamar esta função nesta mesma entrega:
-- a correção passa a ser feita só em Catálogo > Vínculos NF-e, com versão e
-- histórico. A função continua existindo para o site que ainda está no ar
-- durante a troca e sai numa migration seguinte, depois que o site novo estiver
-- publicado (mudança destrutiva em duas fases, docs/regras/BANCO.md).
--
-- Parte da definição vigente (20260902142639_classificacao_itens_nfe.sql) e só
-- troca a verificação de acesso.

begin;

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
  if not private.pode_corrigir_vinculos_nfe() then
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
      id uuid, conversion_basis text, conversion_factor numeric
    )
  loop
    if v_mapping.id is null
       or v_mapping.conversion_basis not in ('simple', 'package', 'usable')
       or v_mapping.conversion_factor is null or v_mapping.conversion_factor <= 0 then
      raise exception using errcode = '22023', message = 'Fator de conversão inválido.';
    end if;
    update public.payable_product_mappings mapping
    set conversion_basis = v_mapping.conversion_basis,
        conversion_factor = v_mapping.conversion_factor,
        factor_confirmed = true, last_confirmed_at = now(),
        last_confirmed_by = (select auth.uid()), updated_at = now()
    where mapping.id = v_mapping.id and mapping.base_product_id = p_product_id and mapping.active;
    if not found then
      raise exception using errcode = '22023', message = 'Conversão não pertence ao produto informado.';
    end if;
  end loop;
end;
$$;

revoke all on function public.update_payable_product_mappings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_payable_product_mappings(uuid, jsonb) to authenticated;

commit;
