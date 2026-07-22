begin;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'purchase_lists',
        'purchase_items',
        'quotations',
        'quotation_items',
        'quotation_suppliers',
        'quotation_responses',
        'supplier_products',
        'supplier_orders',
        'supplier_order_items'
      ])
  loop
    execute format(
      'drop policy %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end;
$$;

revoke all privileges on table
  public.purchase_lists,
  public.purchase_items,
  public.quotations,
  public.quotation_items,
  public.quotation_suppliers,
  public.quotation_responses,
  public.supplier_products,
  public.supplier_orders,
  public.supplier_order_items
from public, anon, authenticated;

commit;
