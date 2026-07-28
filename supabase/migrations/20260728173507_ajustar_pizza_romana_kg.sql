with pizza_romana as (
  select product.id
  from public.products product
  where product.category = 'Pizza Romana'
     or product.name ilike '%Pizza Romana%'
)
update public.products product
set unit = 'kg'
from pizza_romana target
where product.id = target.id
  and product.unit is distinct from 'kg';

with pizza_romana as (
  select product.id
  from public.products product
  where product.category = 'Pizza Romana'
     or product.name ilike '%Pizza Romana%'
)
update public.product_sale_options option
set is_default = false,
    updated_at = now()
from pizza_romana target
where option.product_id = target.id
  and option.sale_unit <> 'kg'
  and option.is_default;

with pizza_romana as (
  select product.id
  from public.products product
  where product.category = 'Pizza Romana'
     or product.name ilike '%Pizza Romana%'
)
insert into public.product_sale_options (
  product_id,
  name,
  sale_unit,
  reference_quantity,
  unit_weight_kg,
  is_default,
  active
)
select
  target.id,
  'Quilo',
  'kg',
  1,
  null,
  true,
  true
from pizza_romana target
on conflict (product_id, sale_unit) do update set
  name = excluded.name,
  reference_quantity = excluded.reference_quantity,
  unit_weight_kg = excluded.unit_weight_kg,
  is_default = excluded.is_default,
  active = excluded.active,
  updated_at = now();
