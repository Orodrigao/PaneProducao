begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin
) values
  ('9e000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','pj-lock-admin@example.com','',now(),now(),now(),
   '{"provider":"email","providers":["email"]}','{}',false),
  ('9e000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','pj-lock-sem-acesso@example.com','',now(),now(),now(),
   '{"provider":"email","providers":["email"]}','{}',false),
  ('9e000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','pj-lock-expedicao@example.com','',now(),now(),now(),
   '{"provider":"email","providers":["email"]}','{}',false);

insert into public.app_profiles(user_id, display_name, role, store, active, allowed_routes)
values
  ('9e000000-0000-4000-8000-000000000001','Contrato PJ concorrencia','admin','jc',true,'["/pedidos-pj"]'),
  ('9e000000-0000-4000-8000-000000000002','Sem escrita PJ','expedicao','jc',true,'["/pedidos-pj"]'),
  ('9e000000-0000-4000-8000-000000000003','Expedicao concorrencia PJ','expedicao','jc',true,'["/pedidos-pj"]');

insert into public.app_user_permissions(user_id, permission_key, scope)
values ('9e000000-0000-4000-8000-000000000003','pedidos_pj.confirmar_envio','jc');

insert into public.customers(id, name, doc, payment_term_days, active)
values ('9e000000-0000-4000-8000-000000000010','[TESTE] Cliente concorrencia PJ','00000000000097',7,true);

insert into public.breads(id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-lock-pj-a','[TESTE] Pao lock A','{0,1,2,3,4,5,6}',true,'un',false,false),
  ('teste-lock-pj-b','[TESTE] Pao lock B','{0,1,2,3,4,5,6}',true,'un',false,false);

insert into public.customer_price_overrides(
  customer_id, product_id, product_source, product_name,
  unit_price, pricing_unit, pack_size, active
) values
  ('9e000000-0000-4000-8000-000000000010','teste-lock-pj-a','bread',
   '[TESTE] Pao lock A',10,'un',1,true),
  ('9e000000-0000-4000-8000-000000000010','teste-lock-pj-b','bread',
   '[TESTE] Pao lock B',20,'un',1,true);

create function pg_temp.pedido(p_quantidade numeric default 5) returns jsonb
language sql stable as $$
  select jsonb_build_array(
    jsonb_build_object(
      'bread_id','teste-lock-pj-a','product_source','bread',
      'product_name','[TESTE] Pao lock A','quantity',p_quantidade,'unit_price',10,
      'pack_size',1,'pricing_unit','un','customer_id','9e000000-0000-4000-8000-000000000010',
      'pj_client','[TESTE] Cliente concorrencia PJ','order_date',private.data_na_padaria(),
      'delivery_date',private.data_na_padaria()+2,'pj_delivery_date',private.data_na_padaria()+2
    ),
    jsonb_build_object(
      'bread_id','teste-lock-pj-b','product_source','bread',
      'product_name','[TESTE] Pao lock B','quantity',2,'unit_price',20,
      'pack_size',1,'pricing_unit','un','customer_id','9e000000-0000-4000-8000-000000000010',
      'pj_client','[TESTE] Cliente concorrencia PJ','order_date',private.data_na_padaria(),
      'delivery_date',private.data_na_padaria()+2,'pj_delivery_date',private.data_na_padaria()+2
    )
  );
$$;

create function pg_temp.versao(p_group uuid) returns jsonb
language sql stable as $$
  select jsonb_agg(
    jsonb_build_object('id', id, 'updated_at', updated_at)
    order by id
  )
  from public.orders
  where order_group_id = p_group;
$$;

select ok(
  not has_function_privilege(
    'anon', 'public.replace_pj_order_atomic_v2(uuid,uuid,jsonb,jsonb)', 'execute'
  ),
  'anonimo nao chama a edicao concorrente'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.replace_pj_order_atomic_v2(uuid,uuid,jsonb,jsonb)', 'execute'
  ),
  'usuario autenticado pode chegar ao contrato, sujeito a validacao interna'
);
select ok(
  pg_get_functiondef(
    'public.save_pj_order_dispatch_quantities(uuid,uuid,jsonb,timestamptz)'::regprocedure
  ) ilike '%order by order_row.id%for update%',
  'conferencia pre-trava todas as linhas na ordem canonica'
);
select ok(
  pg_get_functiondef('public.confirm_pj_order_dispatch(uuid)'::regprocedure)
    ilike '%order by order_row.id%for update%',
  'saida pre-trava todas as linhas na ordem canonica'
);
select ok(
  pg_get_functiondef(
    'private.schedule_pj_production_contract_impl(date,jsonb,uuid)'::regprocedure
  ) ilike '%order by order_row.id%for update%',
  'producao pre-trava os itens na ordem canonica antes do loop legado'
);
select ok(
  pg_get_functiondef(
    'private.schedule_pj_production_contract_impl(date,jsonb,uuid)'::regprocedure
  ) ilike '%pg_advisory_xact_lock%pane-pj-production-schedule%',
  'producao serializa a programacao antes de qualquer trava de linha ou saldo'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.save_pj_order_dispatch_quantities_lock_order_impl(uuid,uuid,jsonb,timestamptz)',
    'execute'
  ),
  'implementacao antiga da conferencia nao fica exposta ao navegador'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.confirm_pj_order_dispatch_lock_order_impl(uuid)',
    'execute'
  ),
  'implementacao antiga da saida nao fica exposta ao navegador'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.schedule_pj_production_lock_order_impl(date,jsonb,uuid)',
    'execute'
  ),
  'implementacao antiga da producao nao fica exposta ao navegador'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.save_pj_order_dispatch_quantities_lock_order_impl(uuid,uuid,jsonb,timestamptz)',
    'execute'
  ),
  'service role tambem nao contorna a ordem canonica da conferencia'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.confirm_pj_order_dispatch_lock_order_impl(uuid)',
    'execute'
  ),
  'service role tambem nao contorna a ordem canonica da saida'
);
select ok(
  not has_function_privilege(
    'service_role',
    'private.schedule_pj_production_lock_order_impl(date,jsonb,uuid)',
    'execute'
  ),
  'service role tambem nao contorna a serializacao da producao'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','9e000000-0000-4000-8000-000000000001',true);
select lives_ok($q$
  select public.create_pj_order_atomic(
    '9e000000-0000-4000-8000-000000000101',
    '9e000000-0000-4000-8000-000000000201',
    pg_temp.pedido()
  )
$q$, 'prepara pedido legado identificado sem ativar a jornada');
select lives_ok($q$
  select public.replace_pj_order_atomic_v2(
    '9e000000-0000-4000-8000-000000000102',
    '9e000000-0000-4000-8000-000000000201',
    pg_temp.pedido(7),
    pg_temp.versao('9e000000-0000-4000-8000-000000000201')
  )
$q$, 'snapshot exato permite editar o pedido');
reset role;

select is(
  (select quantity from public.orders
   where order_group_id='9e000000-0000-4000-8000-000000000201'
     and bread_id='teste-lock-pj-a'),
  7::numeric,
  'edicao valida persiste a nova quantidade'
);
select is(
  (select count(*)::int from private.pj_flow
   where order_group_id='9e000000-0000-4000-8000-000000000201'),
  0,
  'editar nao converte pedido historico para a nova jornada'
);

create temporary table retry_payload as
select request_payload->'expected_rows' as rows
from private.pj_order_write_requests
where request_id='9e000000-0000-4000-8000-000000000102';
grant select on retry_payload to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','9e000000-0000-4000-8000-000000000001',true);
select is(
  (public.replace_pj_order_atomic_v2(
    '9e000000-0000-4000-8000-000000000102',
    '9e000000-0000-4000-8000-000000000201',
    pg_temp.pedido(7),
    (select rows from retry_payload)
  )->>'repeated')::boolean,
  true,
  'repeticao da mesma tentativa devolve o sucesso mesmo com snapshot antigo'
);
select throws_ok($q$
  select public.replace_pj_order_atomic_v2(
    '9e000000-0000-4000-8000-000000000102',
    '9e000000-0000-4000-8000-000000000201',
    pg_temp.pedido(7),
    pg_temp.versao('9e000000-0000-4000-8000-000000000201')
  )
$q$, '22023', 'Identificador ja usado para outra operacao.',
  'mesmo identificador nao aceita uma versao esperada diferente');
reset role;

create temporary table snapshot_anterior as
select pg_temp.versao('9e000000-0000-4000-8000-000000000201') as rows;
grant select on snapshot_anterior to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','9e000000-0000-4000-8000-000000000001',true);
select lives_ok($q$
  select public.replace_pj_order_atomic_v2(
    '9e000000-0000-4000-8000-000000000103',
    '9e000000-0000-4000-8000-000000000201',
    pg_temp.pedido(9),
    (select rows from snapshot_anterior)
  )
$q$, 'primeira pessoa salva sobre a versao que abriu');
select throws_ok($q$
  select public.replace_pj_order_atomic_v2(
    '9e000000-0000-4000-8000-000000000104',
    '9e000000-0000-4000-8000-000000000201',
    pg_temp.pedido(11),
    (select rows from snapshot_anterior)
  )
$q$, '40001', 'Pedido mudou; recarregue antes de salvar novamente.',
  'segunda pessoa com a tela antiga nao sobrescreve a primeira');
reset role;

select is(
  (select quantity from public.orders
   where order_group_id='9e000000-0000-4000-8000-000000000201'
     and bread_id='teste-lock-pj-a'),
  9::numeric,
  'recusa concorrente conserva a alteracao da primeira pessoa'
);
select is(
  (select count(*)::int from private.pj_order_write_requests
   where request_id='9e000000-0000-4000-8000-000000000104'),
  0,
  'recusa concorrente nao registra sucesso falso'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','9e000000-0000-4000-8000-000000000001',true);
select throws_ok($q$
  select public.replace_pj_order_atomic_v2(
    '9e000000-0000-4000-8000-000000000105',
    '9e000000-0000-4000-8000-000000000201',
    pg_temp.pedido(12),
    (select jsonb_agg(value) from (
      select value
      from jsonb_array_elements(pg_temp.versao('9e000000-0000-4000-8000-000000000201'))
      limit 1
    ) one_row)
  )
$q$, '40001', 'Pedido mudou; recarregue antes de salvar novamente.',
  'snapshot incompleto e tratado como pedido alterado');
select throws_ok($q$
  select public.replace_pj_order_atomic_v2(
    '9e000000-0000-4000-8000-000000000106',
    '9e000000-0000-4000-8000-000000000201',
    pg_temp.pedido(12),
    pg_temp.versao('9e000000-0000-4000-8000-000000000201') || jsonb_build_array(
      jsonb_build_object(
        'id','9e000000-0000-4000-8000-000000000999',
        'updated_at',clock_timestamp()
      )
    )
  )
$q$, '40001', 'Pedido mudou; recarregue antes de salvar novamente.',
  'snapshot com linha extra e tratado como pedido alterado');
select throws_ok($q$
  select public.replace_pj_order_atomic_v2(
    '9e000000-0000-4000-8000-000000000107',
    '9e000000-0000-4000-8000-000000000201',
    pg_temp.pedido(12),
    jsonb_build_array(jsonb_build_object('id','invalido','updated_at','ontem'))
  )
$q$, '22023', 'A versao anterior do pedido e invalida.',
  'snapshot malformado e recusado antes da escrita');
reset role;

create temporary table snapshot_antes_conferencia as
select pg_temp.versao('9e000000-0000-4000-8000-000000000201') as rows;
grant select on snapshot_antes_conferencia to authenticated;

create temporary table item_conferencia as
select id
from public.orders
where order_group_id='9e000000-0000-4000-8000-000000000201'
  and bread_id='teste-lock-pj-a';
grant select on item_conferencia to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','9e000000-0000-4000-8000-000000000003',true);
select lives_ok($q$
  select public.save_pj_order_dispatch_quantities(
    '9e000000-0000-4000-8000-000000000109',
    '9e000000-0000-4000-8000-000000000201',
    jsonb_build_array(jsonb_build_object(
      'order_id',(select id from item_conferencia),
      'quantity',9,
      'reason',null
    )),
    null
  )
$q$, 'expedicao grava a conferencia sem trocar id nem updated_at');
select set_config('request.jwt.claim.sub','9e000000-0000-4000-8000-000000000001',true);
select throws_ok($q$
  select public.replace_pj_order_atomic_v2(
    '9e000000-0000-4000-8000-000000000110',
    '9e000000-0000-4000-8000-000000000201',
    pg_temp.pedido(13),
    (select rows from snapshot_antes_conferencia)
  )
$q$, '22023', 'Pedido que ja entrou na operacao ou no financeiro nao pode ser alterado.',
  'edicao nao apaga uma conferencia que preservou id e updated_at');
select set_config('request.jwt.claim.sub','9e000000-0000-4000-8000-000000000002',true);
select throws_ok($q$
  select public.replace_pj_order_atomic_v2(
    '9e000000-0000-4000-8000-000000000108',
    '9e000000-0000-4000-8000-000000000201',
    pg_temp.pedido(12),
    pg_temp.versao('9e000000-0000-4000-8000-000000000201')
  )
$q$, '42501', 'Sem permissao para criar, alterar ou cancelar Pedidos PJ.',
  'perfil operacional nao ganha escrita pelo novo contrato');
reset role;

select is(
  (select quantity from public.orders
   where order_group_id='9e000000-0000-4000-8000-000000000201'
     and bread_id='teste-lock-pj-a'),
  9::numeric,
  'recusa depois da conferencia conserva o pedido comercial'
);
select is(
  (select dispatched_quantity from public.orders
   where order_group_id='9e000000-0000-4000-8000-000000000201'
     and bread_id='teste-lock-pj-a'),
  9::numeric,
  'recusa depois da conferencia conserva o trabalho da expedicao'
);
select is(
  (select action from private.pj_order_write_requests
   where request_id='9e000000-0000-4000-8000-000000000103'),
  'replace_v2',
  'auditoria distingue a edicao protegida da versao antiga'
);
select ok(
  (select request_payload ? 'rows' and request_payload ? 'expected_rows'
   from private.pj_order_write_requests
   where request_id='9e000000-0000-4000-8000-000000000103'),
  'auditoria preserva corpo e versao esperada para repeticao exata'
);

select * from finish();
rollback;
