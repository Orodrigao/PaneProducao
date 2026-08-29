-- Dados deliberadamente ficticios para ambientes locais e Preview.
-- Nunca executar com `--include-seed` em producao.
-- Contas com senha sao criadas pelo Supabase Auth na etapa de infraestrutura;
-- este seed apenas liga perfis/permissoes quando os e-mails ja existem.

-- Producao grava o codigo do destino em MAIUSCULAS ('JC', 'JA', 'EX'). O seed
-- precisa reproduzir isso: quem compara o codigo sem normalizar passava em
-- producao e falhava no Preview. Atencao: `code` e o codigo do destino, e nao
-- se confunde com `app_user_permissions.scope`, `app_profiles.store` nem
-- `bread_movements.location` -- esses o banco guarda em minusculas de verdade.
-- O update abaixo deixa o seed idempotente num banco que ainda tenha a grafia
-- antiga; em banco novo nao faz nada.
update public.destinations set code = upper(code) where code <> upper(code);

insert into public.destinations (id, name, code, type, requires_conferencia, active)
values
  ('20000000-0000-4000-8000-000000000001', '[TESTE] Julio de Castilhos', 'JC', 'loja', false, true),
  ('20000000-0000-4000-8000-000000000002', '[TESTE] Jardim America', 'JA', 'loja', false, true),
  ('20000000-0000-4000-8000-000000000003', '[TESTE] Exposicao', 'EX', 'loja', true, true)
on conflict (code) do update set
  name = excluded.name,
  type = excluded.type,
  requires_conferencia = excluded.requires_conferencia,
  active = excluded.active;

insert into public.products (
  id, name, category, active, sort_order, unit, kind,
  is_fabricacao_propria, production_days, production_area
)
values
  ('10000000-0000-4000-8000-000000000001', '[TESTE] Bruschetta Brie', 'Bruschettas', true, 10, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000002', '[TESTE] Bruschetta de Alcachofra', 'Bruschettas', true, 20, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000003', '[TESTE] Bruschetta Gorgonzola', 'Bruschettas', true, 30, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000004', '[TESTE] Bruschetta Parma', 'Bruschettas', true, 40, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000005', '[TESTE] Pastinha de Azeitona', 'Pastas & Pesto', true, 50, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000006', '[TESTE] Pastinha de Frango', 'Pastas & Pesto', true, 60, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000007', '[TESTE] Pastinha de Manjericão', 'Pastas & Pesto', true, 70, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000008', '[TESTE] Pastinha de Tomate-Seco', 'Pastas & Pesto', true, 80, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000009', '[TESTE] Pesto Rosso', 'Pastas & Pesto', true, 90, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000010', '[TESTE] Pesto Verde', 'Pastas & Pesto', true, 100, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000011', '[TESTE] Pizza Redonda de Calabresa', 'Pizza Redonda', true, 110, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000012', '[TESTE] Pizza Redonda de Portuguesa', 'Pizza Redonda', true, 120, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000013', '[TESTE] Pizza Redonda de Queijo e Cebola', 'Pizza Redonda', true, 130, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000014', '[TESTE] Pizza Redonda Margherita', 'Pizza Redonda', true, 140, 'un', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000015', '[TESTE] Pizza Romana de Calabresa', 'Pizza Romana', true, 150, 'kg', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000016', '[TESTE] Pizza Romana de Carne e Azeitona', 'Pizza Romana', true, 160, 'kg', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000017', '[TESTE] Pizza Romana de Carne e Cebola Caramelizada', 'Pizza Romana', true, 170, 'kg', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000018', '[TESTE] Pizza Romana de Carne e Coalho', 'Pizza Romana', true, 180, 'kg', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000019', '[TESTE] Pizza Romana de Gorgonzola', 'Pizza Romana', true, 190, 'kg', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha'),
  ('10000000-0000-4000-8000-000000000020', '[TESTE] Pizza Romana de Parma', 'Pizza Romana', true, 200, 'kg', 'final', true, '{0,1,2,3,4,5,6}', 'cozinha')
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  active = excluded.active,
  sort_order = excluded.sort_order,
  unit = excluded.unit,
  kind = excluded.kind,
  is_fabricacao_propria = excluded.is_fabricacao_propria,
  production_days = excluded.production_days,
  production_area = excluded.production_area;

insert into public.products (
  id, name, category, active, sort_order, unit, kind,
  is_fabricacao_propria, production_days, production_area
)
values
  ('10000000-0000-4000-8000-000000000021', '[TESTE] Manjericão', 'Insumos', true, 210, 'kg', 'insumo', false, '{0,1,2,3,4,5,6}', 'outros'),
  ('10000000-0000-4000-8000-000000000022', '[TESTE] Tomate cereja', 'Insumos', true, 220, 'kg', 'insumo', false, '{0,1,2,3,4,5,6}', 'outros')
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  active = excluded.active,
  sort_order = excluded.sort_order,
  unit = excluded.unit,
  kind = excluded.kind,
  is_fabricacao_propria = excluded.is_fabricacao_propria,
  production_days = excluded.production_days,
  production_area = excluded.production_area;

insert into public.suppliers (id, name, active)
values ('40000000-0000-4000-8000-000000000001', '[TESTE] Fornecedor CEASA JC', true)
on conflict (id) do update set name = excluded.name, active = excluded.active;

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values
  ('teste-baguete', '[TESTE] Baguete', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-ciabatta', '[TESTE] Ciabatta', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  -- Exclusivos do cenario PJ: nao entram na composicao de planejamento nem no
  -- cenario de sobras, para nao alterar as quantidades ja conferidas por outros
  -- testes.
  ('teste-brioche-pj', '[TESTE] Brioche PJ', '{0,1,2,3,4,5,6}', true, 'un', false, false),
  ('teste-focaccia-pj', '[TESTE] Focaccia PJ', '{0,1,2,3,4,5,6}', true, 'kg', false, false)
on conflict (id) do update set
  name = excluded.name,
  days = excluded.days,
  active = excluded.active,
  unit = excluded.unit,
  is_special = excluded.is_special,
  is_shelf = excluded.is_shelf;

-- Cenario comercial PJ: tabela de preco, clientes e pedidos.
--
-- As datas sao afastadas do dia da reconstrucao de proposito. Um cenario
-- semeado com "hoje" vence a meia-noite: os pedidos em aberto saem da fila da
-- Expedicao (que so mostra entrega ainda nao vencida) e o teste do dia
-- seguinte encontra a tela vazia. Entrega +1 sobrevive ao virar do dia e ao
-- fuso entre o banco (UTC) e a padaria (America/Sao_Paulo).
-- Sem isso o Preview nao permite criar nem conferir Pedido PJ, e o relatorio de
-- Vendas PJ fica sempre zerado.

insert into public.price_tiers (id, name, description, active)
values ('50000000-0000-4000-8000-000000000001', '[TESTE] Tabela PJ', 'Precos ficticios para validar Pedidos PJ e o relatorio de Vendas PJ.', true)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  active = excluded.active;

insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name,
  unit_price, pricing_unit, pack_size, active
)
values
  -- Pacote de 12, como o brioche real da padaria. O que o cenario reproduz e
  -- o caso de pacote maior que 1, que ja inflou o relatorio de Vendas PJ.
  ('51000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001',
   'teste-brioche-pj', 'bread', '[TESTE] Brioche PJ', 1.60, 'un', 12, true),
  -- Preco por quilo: o outro caminho da conta, que nunca usou pacote.
  ('51000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001',
   'teste-focaccia-pj', 'bread', '[TESTE] Focaccia PJ', 89.00, 'kg', 1, true),
  ('51000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001',
   'teste-baguete', 'bread', '[TESTE] Baguete', 2.97, 'un', 1, true)
on conflict (id) do update set
  tier_id = excluded.tier_id,
  product_id = excluded.product_id,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  unit_price = excluded.unit_price,
  pricing_unit = excluded.pricing_unit,
  pack_size = excluded.pack_size,
  active = excluded.active;

-- O terceiro cliente nasce sem prazo de propósito: e o cenario que prova que a
-- tela avisa "sem prazo definido" e que o contas a receber nao inventa
-- vencimento para quem ainda nao combinou prazo.
insert into public.customers (
  id, name, doc, contact, default_tier_id, discount_pct, delivery_hours,
  payment_term_days, active, notes
)
values
  ('60000000-0000-4000-8000-000000000001', '[TESTE] Bistro Cliente PJ', '00.000.000/0001-91',
   'contato-teste@exemplo.invalid', '50000000-0000-4000-8000-000000000001', 0, 48,
   28, true, 'Cliente ficticio para validar Pedidos PJ.'),
  ('60000000-0000-4000-8000-000000000002', '[TESTE] Cafe Cliente PJ', '00.000.000/0002-72',
   'contato-teste2@exemplo.invalid', '50000000-0000-4000-8000-000000000001', 10, 24,
   0, true, 'Cliente ficticio com desconto base de 10% e pagamento a vista.'),
  -- Prazo de 21 dias para o cenario de dividir a fatura: 3x vence em 7, 14 e 21.
  -- Sem ele, todo cliente do Preview ou paga a vista ou tem prazo que nao
  -- ilustra a divisao.
  ('60000000-0000-4000-8000-000000000004', '[TESTE] Restaurante Parcela', '00.000.000/0004-34',
   'contato-teste4@exemplo.invalid', '50000000-0000-4000-8000-000000000001', 0, 48,
   21, true, 'Cliente ficticio de prazo 21 dias, para testar a fatura dividida em 2x e 3x.'),
  ('60000000-0000-4000-8000-000000000003', '[TESTE] Padaria Sem Prazo', '00.000.000/0003-53',
   'contato-teste3@exemplo.invalid', '50000000-0000-4000-8000-000000000001', 0, 48,
   null, true, 'Cliente ficticio sem prazo combinado, para validar o aviso na tela.'),
  -- Cliente exclusivo do cenario de conferencia da quantidade enviada. Cada
  -- cenario com o seu cliente: reaproveitar um cliente que ja aparece em
  -- assercao por nome faz o smoke do navegador achar dois pedidos onde
  -- esperava um.
  ('60000000-0000-4000-8000-000000000005', '[TESTE] Deli Conferencia PJ', '00.000.000/0005-15',
   'contato-teste5@exemplo.invalid', '50000000-0000-4000-8000-000000000001', 0, 48,
   15, true, 'Cliente ficticio do cenario de conferencia da quantidade enviada.')
on conflict (id) do update set
  name = excluded.name,
  doc = excluded.doc,
  contact = excluded.contact,
  default_tier_id = excluded.default_tier_id,
  discount_pct = excluded.discount_pct,
  delivery_hours = excluded.delivery_hours,
  payment_term_days = excluded.payment_term_days,
  active = excluded.active,
  notes = excluded.notes;

-- Pedidos PJ ficticios. `quantity` ja e a quantidade final vendida
-- (pacotes x pack_size); o valor da linha e sempre unit_price x quantity.
--
-- Os gatilhos `guard_pj_dispatch_write` e `guard_dispatched_pj_order_changes`
-- reservam a confirmacao de envio para a acao protegida do banco. O seed usa a
-- mesma chave que essa acao usa, e so para semear o pedido ja enviado; a chave
-- e fechada logo abaixo. Sem isso o cenario nao consegue representar um pedido
-- no Historico, e reaplicar o seed falharia ao tocar essa linha.
select set_config('pane.pj_dispatch_rpc', 'on', false);
-- Mesma ideia para a conferencia da quantidade enviada: o gatilho
-- `guard_dispatched_quantity` reserva essas colunas a acao protegida, e o seed
-- precisa semear o cenario de conferencia parcial. A chave fecha logo abaixo.
select set_config('pane.pj_check_rpc', 'on', false);

insert into public.orders (
  id, store, order_type, order_group_id, customer_id, pj_client,
  bread_id, product_source, product_name,
  quantity, unit_price, pack_size, pricing_unit,
  order_date, delivery_date, production_date, pj_delivery_date,
  obs, needs_production,
  dispatched_at, dispatched_by, dispatched_by_name,
  cancelled_at, cancelled_by, cancel_reason,
  dispatched_quantity, dispatched_quantity_reason,
  dispatched_quantity_at, dispatched_quantity_by_name
)
values
  -- Em aberto: 21 pacotes de 12 = 252 un x R$ 1,60 = R$ 403,20.
  ('30000000-0000-4000-8000-000000000101', 'pj', 'pj',
   '70000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001', '[TESTE] Bistro Cliente PJ',
   'teste-brioche-pj', 'bread', '[TESTE] Brioche PJ',
   252, 1.60, 12, 'un',
   (now() at time zone 'America/Sao_Paulo')::date,
   (now() at time zone 'America/Sao_Paulo')::date + 2,
   null,
   (now() at time zone 'America/Sao_Paulo')::date + 2,
   '[TESTE] pedido com pacote de 12 para conferir o valor do relatorio', false,
   null, null, null, null, null, null,
   null, null, null, null),
  -- Em aberto por quilo: 4,5 kg x R$ 89,00 = R$ 400,50.
  ('30000000-0000-4000-8000-000000000102', 'pj', 'pj',
   '70000000-0000-4000-8000-000000000002',
   '60000000-0000-4000-8000-000000000002', '[TESTE] Cafe Cliente PJ',
   'teste-focaccia-pj', 'bread', '[TESTE] Focaccia PJ',
   4.5, 89.00, 1, 'kg',
   (now() at time zone 'America/Sao_Paulo')::date,
   (now() at time zone 'America/Sao_Paulo')::date + 2,
   null,
   (now() at time zone 'America/Sao_Paulo')::date + 2,
   '[TESTE] pedido por quilo, sem pacote', false,
   null, null, null, null, null, null,
   null, null, null, null),
  -- Enviado: sai da fila e vai para o Historico. 4 pacotes de 12 = 48 un = R$ 76,80.
  ('30000000-0000-4000-8000-000000000103', 'pj', 'pj',
   '70000000-0000-4000-8000-000000000003',
   '60000000-0000-4000-8000-000000000001', '[TESTE] Bistro Cliente PJ',
   'teste-brioche-pj', 'bread', '[TESTE] Brioche PJ',
   48, 1.60, 12, 'un',
   (now() at time zone 'America/Sao_Paulo')::date - 2,
   (now() at time zone 'America/Sao_Paulo')::date - 1,
   (now() at time zone 'America/Sao_Paulo')::date - 2,
   (now() at time zone 'America/Sao_Paulo')::date - 1,
   '[TESTE] pedido ja enviado pela Expedicao', false,
   now() - interval '2 hours', null, '[TESTE] Expedicao JC',
   null, null, null,
   -- Enviado ANTES da conferencia existir: fica com o campo vazio de
   -- proposito, porque a fase 1 nao retroage (decisao 8 do plano).
   null, null, null, null),
  -- Entregue ontem, de cliente SEM prazo cadastrado: aparece na lista de a
  -- faturar bloqueado, porque nao ha vencimento que se possa calcular. E o
  -- caso que faz dinheiro deixar de ser cobrado em silencio.
  ('30000000-0000-4000-8000-000000000105', 'pj', 'pj',
   '70000000-0000-4000-8000-000000000005',
   '60000000-0000-4000-8000-000000000003', '[TESTE] Padaria Sem Prazo',
   'teste-brioche-pj', 'bread', '[TESTE] Brioche PJ',
   60, 1.60, 12, 'un',
   (now() at time zone 'America/Sao_Paulo')::date - 2,
   (now() at time zone 'America/Sao_Paulo')::date - 1,
   null,
   (now() at time zone 'America/Sao_Paulo')::date - 1,
   '[TESTE] entregue, mas o cliente nao tem prazo combinado', false,
   null, null, null, null, null, null,
   null, null, null, null),
  -- Cancelado: nao entra em nenhuma soma.
  ('30000000-0000-4000-8000-000000000104', 'pj', 'pj',
   '70000000-0000-4000-8000-000000000004',
   '60000000-0000-4000-8000-000000000002', '[TESTE] Cafe Cliente PJ',
   'teste-brioche-pj', 'bread', '[TESTE] Brioche PJ',
   24, 1.60, 12, 'un',
   (now() at time zone 'America/Sao_Paulo')::date,
   (now() at time zone 'America/Sao_Paulo')::date,
   (now() at time zone 'America/Sao_Paulo')::date,
   (now() at time zone 'America/Sao_Paulo')::date,
   '[TESTE] pedido cancelado, fora de qualquer soma', false,
   null, null, null,
   now() - interval '1 hour', '[TESTE] Financeiro JC',
   'Cenario de teste do cancelamento',
   null, null, null, null),
  -- CONFERENCIA PARCIAL, em duas linhas: a primeira ja conferida com o peso
  -- real, a segunda ainda nao. E o cenario que mostra o bloqueio do "Marcar
  -- como enviado" com o motivo escrito na tela.
  -- Entrega em hoje+2: dado preso ao dia exato so funciona no minuto em que
  -- foi criado (licao `seed-com-hoje-vence-a-meia-noite`).
  ('30000000-0000-4000-8000-000000000106', 'pj', 'pj',
   '70000000-0000-4000-8000-000000000006',
   '60000000-0000-4000-8000-000000000005', '[TESTE] Deli Conferencia PJ',
   'teste-focaccia-pj', 'bread', '[TESTE] Focaccia PJ',
   3, 89.00, 1, 'kg',
   (now() at time zone 'America/Sao_Paulo')::date,
   (now() at time zone 'America/Sao_Paulo')::date + 3,
   null,
   (now() at time zone 'America/Sao_Paulo')::date + 3,
   '[TESTE] conferencia pela metade: esta linha ja foi conferida', false,
   null, null, null, null, null, null,
   3.067, null, now() - interval '30 minutes', '[TESTE] Expedicao JC'),
  ('30000000-0000-4000-8000-000000000107', 'pj', 'pj',
   '70000000-0000-4000-8000-000000000006',
   '60000000-0000-4000-8000-000000000005', '[TESTE] Deli Conferencia PJ',
   'teste-brioche-pj', 'bread', '[TESTE] Brioche PJ',
   48, 1.60, 12, 'un',
   (now() at time zone 'America/Sao_Paulo')::date,
   (now() at time zone 'America/Sao_Paulo')::date + 3,
   null,
   (now() at time zone 'America/Sao_Paulo')::date + 3,
   '[TESTE] esta linha ainda NAO foi conferida, e e ela que segura o envio', false,
   null, null, null, null, null, null,
   null, null, null, null)
on conflict (id) do update set
  store = excluded.store,
  order_type = excluded.order_type,
  order_group_id = excluded.order_group_id,
  customer_id = excluded.customer_id,
  pj_client = excluded.pj_client,
  bread_id = excluded.bread_id,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  quantity = excluded.quantity,
  unit_price = excluded.unit_price,
  pack_size = excluded.pack_size,
  pricing_unit = excluded.pricing_unit,
  order_date = excluded.order_date,
  delivery_date = excluded.delivery_date,
  production_date = excluded.production_date,
  pj_delivery_date = excluded.pj_delivery_date,
  obs = excluded.obs,
  needs_production = excluded.needs_production,
  dispatched_at = excluded.dispatched_at,
  dispatched_by = excluded.dispatched_by,
  dispatched_by_name = excluded.dispatched_by_name,
  cancelled_at = excluded.cancelled_at,
  cancelled_by = excluded.cancelled_by,
  cancel_reason = excluded.cancel_reason,
  dispatched_quantity = excluded.dispatched_quantity,
  dispatched_quantity_reason = excluded.dispatched_quantity_reason,
  dispatched_quantity_at = excluded.dispatched_quantity_at,
  dispatched_quantity_by_name = excluded.dispatched_quantity_by_name;

-- Fecha a chave: a partir daqui a confirmacao de envio volta a exigir a acao
-- protegida, inclusive para o restante deste seed.
select set_config('pane.pj_dispatch_rpc', '', false);
select set_config('pane.pj_check_rpc', '', false);

insert into public.orders (
  id, store, bread_id, quantity, order_date, obs,
  order_type, product_source, product_name, needs_production
)
values
  ('30000000-0000-4000-8000-000000000001', 'ja', 'teste-baguete', 20, (now() at time zone 'America/Sao_Paulo')::date, '[TESTE] pedido para validar envio completo', 'producao', 'bread', '[TESTE] Baguete', true),
  ('30000000-0000-4000-8000-000000000002', 'ja', 'teste-ciabatta', 12, (now() at time zone 'America/Sao_Paulo')::date, '[TESTE] pedido para validar envio parcial', 'producao', 'bread', '[TESTE] Ciabatta', true),
  ('30000000-0000-4000-8000-000000000003', 'ex', 'teste-baguete', 8, (now() at time zone 'America/Sao_Paulo')::date, '[TESTE] pedido para validar conferencia', 'producao', 'bread', '[TESTE] Baguete', true),
  ('30000000-0000-4000-8000-000000000005', 'jc', 'teste-baguete', 3, (now() at time zone 'America/Sao_Paulo')::date, '[TESTE] pedido novo ao lado de uma composicao somente reaproveitada', 'producao', 'bread', '[TESTE] Baguete', true)
on conflict (id) do update set
  store = excluded.store,
  bread_id = excluded.bread_id,
  quantity = excluded.quantity,
  order_date = excluded.order_date,
  obs = excluded.obs,
  order_type = excluded.order_type,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  needs_production = excluded.needs_production,
  cancelled_at = null,
  cancelled_by = null,
  cancel_reason = null;

with test_schedule as (
  select (
    (now() at time zone 'America/Sao_Paulo')::date
    + case extract(dow from (now() at time zone 'America/Sao_Paulo')::date)
        when 0 then 1
        when 1 then 1
        when 2 then 1
        when 3 then 1
        when 4 then 2
        when 5 then 1
        when 6 then 2
      end::integer
  ) as production_date
)
insert into public.orders (
  id, store, bread_id, quantity, order_date, obs,
  order_type, product_source, product_name, needs_production
)
select
  '30000000-0000-4000-8000-000000000004',
  'jc',
  'teste-baguete',
  3,
  production_date,
  '[TESTE] pedido total 10 = 5 congelados + 2 sobras + 3 novos',
  'producao',
  'bread',
  '[TESTE] Baguete',
  true
from test_schedule
on conflict (id) do update set
  store = excluded.store,
  bread_id = excluded.bread_id,
  quantity = excluded.quantity,
  order_date = excluded.order_date,
  obs = excluded.obs,
  order_type = excluded.order_type,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  needs_production = excluded.needs_production,
  cancelled_at = null,
  cancelled_by = null,
  cancel_reason = null;

with test_profiles(email, display_name, role, store, allowed_routes) as (
  values
    ('rodrigao+teste@gmail.com', 'Rodrigo Teste', 'admin', null, '["/", "*"]'::jsonb),
    ('rodrigao+teste-vendas-ja@gmail.com', 'Vendas JA Teste', 'vendas', 'ja', '["/romaneio", "/fechamento-caixa", "/sobras", "/encomendas", "/estoque-congelado"]'::jsonb),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'Expedicao JC Teste', 'expedicao', 'jc', '["/", "/romaneio", "/sobras", "/pedidos-pj"]'::jsonb),
    ('rodrigao+teste-romaneio-ex@gmail.com', 'Romaneio EX Teste', 'expedicao', 'ex', '["/romaneio"]'::jsonb),
    ('rodrigao+teste-cozinha-jc@gmail.com', 'Cozinha JC Teste', 'producao', 'jc', '["/producao-cozinha"]'::jsonb),
    ('rodrigao+teste-geolar-jc@gmail.com', 'Geolar JC Teste', 'producao', 'jc', '["/", "/sobras"]'::jsonb),
    -- O financeiro carrega as rotas comerciais do cenario PJ: sem
    -- /pedidos-pj e /relatorios o app redireciona antes de mostrar a lista
    -- (o tripe rota-permissao-RLS precisa concordar nos tres).
    ('rodrigao+teste-financeiro-jc@gmail.com', 'Financeiro JC Teste', 'financeiro', 'jc', '["/", "/contas-pagar", "/contas-receber", "/financeiro", "/fornecedores", "/pedidos-pj", "/relatorios"]'::jsonb)
)
insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes)
select user_account.id, profile.display_name, profile.role, profile.store, true, profile.allowed_routes
from test_profiles profile
join auth.users user_account on lower(user_account.email) = profile.email
on conflict (user_id) do update set
  display_name = excluded.display_name,
  role = excluded.role,
  store = excluded.store,
  active = excluded.active,
  allowed_routes = excluded.allowed_routes;

delete from public.app_user_permissions assignment
where assignment.user_id in (
  select user_account.id
  from auth.users user_account
  where lower(user_account.email) in (
    'rodrigao+teste@gmail.com',
    'rodrigao+teste-vendas-ja@gmail.com',
    'rodrigao+teste-expedicao-jc@gmail.com',
    'rodrigao+teste-romaneio-ex@gmail.com',
    'rodrigao+teste-cozinha-jc@gmail.com',
    'rodrigao+teste-geolar-jc@gmail.com',
    'rodrigao+teste-financeiro-jc@gmail.com'
  )
);

with requested_permissions(email, permission_key, scope) as (
  values
    ('rodrigao+teste-vendas-ja@gmail.com', 'caixa.acessar', '*'),
    ('rodrigao+teste-vendas-ja@gmail.com', 'sobras.acessar', '*'),
    ('rodrigao+teste-vendas-ja@gmail.com', 'encomendas.acessar', '*'),
    ('rodrigao+teste-vendas-ja@gmail.com', 'congelado.acessar', '*'),
    ('rodrigao+teste-vendas-ja@gmail.com', 'romaneio.acessar', '*'),
    ('rodrigao+teste-vendas-ja@gmail.com', 'romaneio.visualizar', '*'),
    ('rodrigao+teste-vendas-ja@gmail.com', 'romaneio.confirmar_saida', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'romaneio.acessar', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'romaneio.visualizar', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'romaneio.criar', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'romaneio.confirmar_saida', '*'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'sobras.dar_destino', 'jc'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'sobras.registrar', 'jc'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'pedidos_pj.acessar', 'jc'),
    ('rodrigao+teste-expedicao-jc@gmail.com', 'pedidos_pj.confirmar_envio', 'jc'),
    ('rodrigao+teste-romaneio-ex@gmail.com', 'romaneio.acessar', 'ex'),
    ('rodrigao+teste-romaneio-ex@gmail.com', 'romaneio.visualizar', 'ex'),
    ('rodrigao+teste-romaneio-ex@gmail.com', 'romaneio.conferir_recebimento', 'ex'),
    ('rodrigao+teste-cozinha-jc@gmail.com', 'producao_cozinha.lancar', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_pagar.acessar', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_pagar.lancar', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_pagar.importar_xml', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_pagar.baixar', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_pagar.cancelar', 'jc'),
    -- Sem esta permissao o login filtra /pedidos-pj de volta para fora das
    -- rotas (resolveAllowedRoutes) e o financeiro nao ve a tela.
    ('rodrigao+teste-financeiro-jc@gmail.com', 'pedidos_pj.acessar', 'jc'),
    -- Livro-caixa: escopo global porque o livro cobre a empresa inteira,
    -- inclusive os lancamentos 'geral' (que nao pertencem a uma loja so).
    ('rodrigao+teste-financeiro-jc@gmail.com', 'financeiro.acessar', '*'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'financeiro.lancar', '*'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'financeiro.estornar', '*'),
    -- Contas a receber: mesmo escopo do contas a pagar, porque a operacao PJ
    -- e da JC. Sem estas seis a tela existe e a Elis nao entra.
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_receber.acessar', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_receber.lancar', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_receber.baixar', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_receber.estornar', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_receber.cancelar', 'jc'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'contas_receber.corrigir_vencimento', 'jc'),
    -- Sem estas duas o financeiro nao enxerga a loja EX nem os romaneios dela,
    -- e a tela de Relatorios > Romaneios abre vazia: a RLS de destinations e
    -- romaneios exige permissao de romaneio com escopo da loja. Em producao a
    -- Elis ja tem as duas com escopo global.
    ('rodrigao+teste-financeiro-jc@gmail.com', 'romaneio.acessar', '*'),
    ('rodrigao+teste-financeiro-jc@gmail.com', 'romaneio.visualizar', '*')
), resolved_permissions as (
  select user_account.id as user_id, requested.permission_key, requested.scope
  from requested_permissions requested
  join auth.users user_account on lower(user_account.email) = requested.email
  join public.app_permissions permission on permission.key = requested.permission_key
), admin_permissions as (
  select user_account.id as user_id, permission.key as permission_key, '*'::text as scope
  from auth.users user_account
  cross join public.app_permissions permission
  where lower(user_account.email) = 'rodrigao+teste@gmail.com'
)
insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select user_id, permission_key, scope, null::uuid from resolved_permissions
union all
select user_id, permission_key, scope, null::uuid from admin_permissions
on conflict (user_id, permission_key, scope) do nothing;

-- NF-e fictícia somente para conferir a visualização dos itens no Contas a pagar.
insert into public.payable_purchases (
  id, request_id, store, supplier_id, purchase_date, origin, document_type,
  payment_method, status, total_value, notes, nfe_key, nfe_number, nfe_series,
  nfe_issued_at, classification_status, created_by
)
select
  '80000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000002',
  'jc',
  '40000000-0000-4000-8000-000000000001',
  (now() at time zone 'America/Sao_Paulo')::date,
  'xml', 'nfe', 'boleto', 'aberta', 89.90,
  '[TESTE] NF-e para visualizar itens importados.',
  '35260812345678000195550010009990011009990011', '999001', '1',
  (now() at time zone 'America/Sao_Paulo')::date, 'completa',
  user_account.id
from auth.users user_account
where lower(user_account.email) = 'rodrigao+teste-financeiro-jc@gmail.com'
on conflict (id) do update set
  purchase_date = excluded.purchase_date,
  total_value = excluded.total_value,
  notes = excluded.notes,
  nfe_issued_at = excluded.nfe_issued_at,
  classification_status = excluded.classification_status,
  created_by = excluded.created_by;

with fixture_items (
  id, purchase_id, item_name, unit, quantity, unit_price, source_line_number,
  source_product_code, source_description, source_unit, source_quantity,
  conversion_basis, conversion_factor, usable_quantity, normalized_unit_cost,
  mapping_status
) as (
  values
    ('81000000-0000-4000-8000-000000000001'::uuid, '80000000-0000-4000-8000-000000000001'::uuid, '[TESTE] Farinha de trigo', 'kg', 2, 14.95, 1,
     'TESTE-FAR-01', '[TESTE] Farinha de trigo', 'kg', 2, 'simple', 1, 2, 14.95, 'mapeado'),
    ('81000000-0000-4000-8000-000000000002'::uuid, '80000000-0000-4000-8000-000000000001'::uuid, '[TESTE] Manteiga sem sal', 'un', 3, 20, 2,
     'TESTE-MAN-02', '[TESTE] Manteiga sem sal', 'un', 3, 'simple', 1, 3, 20, 'mapeado')
)
insert into public.payable_purchase_items (
  id, purchase_id, item_name, unit, quantity, unit_price, source_line_number,
  source_product_code, source_description, source_unit, source_quantity,
  conversion_basis, conversion_factor, usable_quantity, normalized_unit_cost,
  mapping_status
)
select fixture.*
from fixture_items fixture
where exists (
  select 1 from public.payable_purchases purchase
  where purchase.id = fixture.purchase_id
)
on conflict (id) do update set
  item_name = excluded.item_name,
  unit = excluded.unit,
  quantity = excluded.quantity,
  unit_price = excluded.unit_price,
  source_line_number = excluded.source_line_number,
  source_product_code = excluded.source_product_code,
  source_description = excluded.source_description,
  source_unit = excluded.source_unit,
  source_quantity = excluded.source_quantity,
  conversion_basis = excluded.conversion_basis,
  conversion_factor = excluded.conversion_factor,
  usable_quantity = excluded.usable_quantity,
  normalized_unit_cost = excluded.normalized_unit_cost,
  mapping_status = excluded.mapping_status;

with fixture_installments (id, purchase_id, installment_number, due_date, amount) as (
  values
    ('82000000-0000-4000-8000-000000000001'::uuid, '80000000-0000-4000-8000-000000000001'::uuid, 1, (now() at time zone 'America/Sao_Paulo')::date + 7, 44.95),
    ('82000000-0000-4000-8000-000000000002'::uuid, '80000000-0000-4000-8000-000000000001'::uuid, 2, (now() at time zone 'America/Sao_Paulo')::date + 14, 44.95)
)
insert into public.payable_installments (id, purchase_id, installment_number, due_date, amount)
select fixture.*
from fixture_installments fixture
where exists (
  select 1 from public.payable_purchases purchase
  where purchase.id = fixture.purchase_id
)
on conflict (id) do update set
  due_date = excluded.due_date,
  amount = excluded.amount;

-- Fornecedor travado de propósito: boleto vencido há 3 dias, para o semáforo
-- de fornecedores ter um vermelho testável no Preview (datas afastadas do
-- dia, nunca em "hoje" — ver lessons.md 2026-08-14).
insert into public.suppliers (id, name, active)
values ('40000000-0000-4000-8000-000000000002', '[TESTE] Moinho Atrasado JC', true)
on conflict (id) do update set name = excluded.name, active = excluded.active;

insert into public.payable_purchases (
  id, request_id, store, supplier_id, purchase_date, origin, document_type,
  payment_method, status, total_value, notes, classification_status, created_by
)
select
  '80000000-0000-4000-8000-000000000003',
  '80000000-0000-4000-8000-000000000004',
  'jc',
  '40000000-0000-4000-8000-000000000002',
  (now() at time zone 'America/Sao_Paulo')::date - 10,
  'manual', 'sem_nota', 'boleto', 'aberta', 120.00,
  '[TESTE] Compra com boleto vencido para o semáforo de fornecedores.',
  'completa',
  user_account.id
from auth.users user_account
where lower(user_account.email) = 'rodrigao+teste-financeiro-jc@gmail.com'
on conflict (id) do update set
  purchase_date = excluded.purchase_date,
  total_value = excluded.total_value,
  notes = excluded.notes,
  status = excluded.status,
  classification_status = excluded.classification_status,
  created_by = excluded.created_by;

insert into public.payable_purchase_items (
  id, purchase_id, item_name, unit, quantity, unit_price, source_line_number, mapping_status
)
select
  '81000000-0000-4000-8000-000000000003'::uuid,
  '80000000-0000-4000-8000-000000000003'::uuid,
  '[TESTE] Farinha especial', 'un', 1, 120.00, 1, 'mapeado'
where exists (
  select 1 from public.payable_purchases purchase
  where purchase.id = '80000000-0000-4000-8000-000000000003'
)
on conflict (id) do update set
  item_name = excluded.item_name,
  unit = excluded.unit,
  quantity = excluded.quantity,
  unit_price = excluded.unit_price,
  mapping_status = excluded.mapping_status;

insert into public.payable_installments (id, purchase_id, installment_number, due_date, amount)
select
  '82000000-0000-4000-8000-000000000003'::uuid,
  '80000000-0000-4000-8000-000000000003'::uuid,
  1,
  (now() at time zone 'America/Sao_Paulo')::date - 3,
  120.00
where exists (
  select 1 from public.payable_purchases purchase
  where purchase.id = '80000000-0000-4000-8000-000000000003'
)
on conflict (id) do update set
  due_date = excluded.due_date,
  current_due_date = null,
  amount = excluded.amount,
  status = 'pendente',
  paid_date = null,
  paid_amount = null,
  paid_method = null,
  paid_at = null,
  paid_by = null;

-- Cadastro duplicado do fornecedor acima, sem compra nenhuma: e o caso real da
-- Bersaglio na JC, onde o nome curto digitado a mao convivia com o nome
-- completo criado pela NF-e, e a divida ficava so no segundo. Serve para o
-- semaforo ter um amarelo testavel ("sem compra registrada"), que nunca pode
-- ser lido como liberado.
insert into public.suppliers (id, name, active)
values ('40000000-0000-4000-8000-000000000003', '[TESTE] Moinho', true)
on conflict (id) do update set name = excluded.name, active = excluded.active;

insert into public.frozen_products (
  id, product_id, product_source, product_name, unit,
  min_stock, active, store, visible_stores
)
values (
  '50000000-0000-4000-8000-000000000001',
  'teste-baguete',
  'bread',
  '[TESTE] Baguete',
  'un',
  0,
  true,
  'jc',
  array['jc']::text[]
)
on conflict (id) do update set
  product_id = excluded.product_id,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  unit = excluded.unit,
  min_stock = excluded.min_stock,
  active = excluded.active,
  store = excluded.store,
  visible_stores = excluded.visible_stores;

insert into public.frozen_stock (id, frozen_product_id, location, quantity, updated_at)
values (
  '51000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'jc-freezer',
  5,
  now()
)
on conflict (id) do update set
  frozen_product_id = excluded.frozen_product_id,
  location = excluded.location,
  quantity = excluded.quantity,
  updated_at = excluded.updated_at;

-- Saldo ficticio para Geolar testar o uso manual de congelado em um pedido PJ.
insert into public.frozen_products (
  id, product_id, product_source, product_name, unit,
  min_stock, active, store, visible_stores
)
values (
  '50000000-0000-4000-8000-000000000003',
  'teste-brioche-pj',
  'bread',
  '[TESTE] Brioche PJ',
  'un',
  0,
  true,
  'jc',
  array['jc']::text[]
)
on conflict (id) do update set
  product_id = excluded.product_id,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  unit = excluded.unit,
  min_stock = excluded.min_stock,
  active = excluded.active,
  store = excluded.store,
  visible_stores = excluded.visible_stores;

insert into public.frozen_stock (id, frozen_product_id, location, quantity, updated_at)
values (
  '51000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000003',
  'jc-freezer',
  30,
  now()
)
on conflict (id) do update set
  frozen_product_id = excluded.frozen_product_id,
  location = excluded.location,
  quantity = excluded.quantity,
  updated_at = excluded.updated_at;

insert into public.frozen_products (
  id, product_id, product_source, product_name, unit,
  min_stock, active, store, visible_stores
)
values (
  '50000000-0000-4000-8000-000000000002',
  'teste-ciabatta',
  'bread',
  '[TESTE] Ciabatta',
  'un',
  0,
  true,
  'jc',
  array['jc']::text[]
)
on conflict (id) do update set
  product_id = excluded.product_id,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  unit = excluded.unit,
  min_stock = excluded.min_stock,
  active = excluded.active,
  store = excluded.store,
  visible_stores = excluded.visible_stores;

insert into public.frozen_stock (id, frozen_product_id, location, quantity, updated_at)
values (
  '51000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000002',
  'jc-freezer',
  8,
  now()
)
on conflict (id) do update set
  frozen_product_id = excluded.frozen_product_id,
  location = excluded.location,
  quantity = excluded.quantity,
  updated_at = excluded.updated_at;

insert into public.frozen_movements (
  id, frozen_product_id, location, movement_type, quantity,
  previous_quantity, responsible, obs
)
values (
  '52000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000002',
  'jc-freezer',
  'entrada',
  8,
  0,
  'Rodrigo Teste',
  '[TESTE] oito ciabattas congeladas para a composicao do dia'
)
on conflict (id) do update set
  frozen_product_id = excluded.frozen_product_id,
  location = excluded.location,
  movement_type = excluded.movement_type,
  quantity = excluded.quantity,
  previous_quantity = excluded.previous_quantity,
  responsible = excluded.responsible,
  obs = excluded.obs;

insert into public.frozen_movements (
  id, frozen_product_id, location, movement_type, quantity,
  previous_quantity, responsible, obs
)
values (
  '52000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'jc-freezer',
  'entrada',
  5,
  0,
  'Rodrigo Teste',
  '[TESTE] saldo congelado reservado para o planejamento da Geolar'
)
on conflict (id) do update set
  frozen_product_id = excluded.frozen_product_id,
  location = excluded.location,
  movement_type = excluded.movement_type,
  quantity = excluded.quantity,
  previous_quantity = excluded.previous_quantity,
  responsible = excluded.responsible,
  obs = excluded.obs;

with test_schedule as (
  select (
    (now() at time zone 'America/Sao_Paulo')::date
    + case extract(dow from (now() at time zone 'America/Sao_Paulo')::date)
        when 0 then 1
        when 1 then 1
        when 2 then 1
        when 3 then 1
        when 4 then 2
        when 5 then 1
        when 6 then 2
      end::integer
  ) as production_date
)
insert into public.sobras (
  id, record_date, responsible, product_id, quantity, obs,
  product_source, store, lot_code, pending_quantity, status,
  physical_location, reconciliation_status, updated_at
)
select
  '53000000-0000-4000-8000-000000000001',
  production_date - 1,
  'Geolar JC Teste',
  'teste-baguete',
  2,
  '[TESTE] sobra reservada para reaproveitamento na produção seguinte',
  'bread',
  'jc',
  'L' || to_char(production_date - 1, 'MMDD'),
  2,
  'pending',
  'padaria_cozinha',
  'awaiting_oven',
  now()
from test_schedule
on conflict (id) do update set
  record_date = excluded.record_date,
  responsible = excluded.responsible,
  product_id = excluded.product_id,
  quantity = excluded.quantity,
  obs = excluded.obs,
  product_source = excluded.product_source,
  store = excluded.store,
  lot_code = excluded.lot_code,
  pending_quantity = excluded.pending_quantity,
  status = excluded.status,
  physical_location = excluded.physical_location,
  reconciliation_status = excluded.reconciliation_status,
  updated_at = excluded.updated_at;

insert into public.sobras (
  id, record_date, responsible, product_id, quantity, obs,
  product_source, store, lot_code, pending_quantity, status,
  physical_location, reconciliation_status, updated_at
)
values (
  '53000000-0000-4000-8000-000000000002',
  (now() at time zone 'America/Sao_Paulo')::date - 1,
  'Geolar JC Teste',
  'teste-ciabatta',
  2,
  '[TESTE] duas ciabattas de sobra para a composicao do dia',
  'bread',
  'jc',
  'L' || to_char((now() at time zone 'America/Sao_Paulo')::date - 1, 'MMDD'),
  2,
  'pending',
  'padaria_cozinha',
  'awaiting_oven',
  now()
)
on conflict (id) do update set
  record_date = excluded.record_date,
  responsible = excluded.responsible,
  product_id = excluded.product_id,
  quantity = excluded.quantity,
  obs = excluded.obs,
  product_source = excluded.product_source,
  store = excluded.store,
  lot_code = excluded.lot_code,
  pending_quantity = excluded.pending_quantity,
  status = excluded.status,
  physical_location = excluded.physical_location,
  reconciliation_status = excluded.reconciliation_status,
  updated_at = excluded.updated_at;

with test_schedule as (
  select (
    (now() at time zone 'America/Sao_Paulo')::date
    + case extract(dow from (now() at time zone 'America/Sao_Paulo')::date)
        when 0 then 1
        when 1 then 1
        when 2 then 1
        when 3 then 1
        when 4 then 2
        when 5 then 1
        when 6 then 2
      end::integer
  ) as production_date
), test_admin as (
  select id
  from auth.users
  where lower(email) = 'rodrigao+teste@gmail.com'
)
insert into public.production_plans (
  id, production_date, status, created_by, created_by_name, updated_at
)
select
  '54000000-0000-4000-8000-000000000001',
  production_date,
  'aguardando_geolar',
  test_admin.id,
  'Rodrigo Teste',
  now()
from test_schedule
cross join test_admin
on conflict (production_date) do update set
  status = excluded.status,
  created_by = excluded.created_by,
  created_by_name = excluded.created_by_name,
  updated_at = excluded.updated_at;

insert into public.production_plan_items (
  id, plan_id, store, bread_id, planned_quantity, frozen_quantity,
  leftover_proposed_quantity, leftover_confirmed_quantity, is_extra,
  order_created_at, order_created_by_name, updated_at
)
select
  '55000000-0000-4000-8000-000000000001',
  plan.id,
  'jc',
  'teste-baguete',
  10,
  5,
  2,
  null,
  false,
  now(),
  'Rodrigo Teste',
  now()
from public.production_plans plan
where plan.id = '54000000-0000-4000-8000-000000000001'
on conflict (plan_id, store, bread_id) do update set
  planned_quantity = excluded.planned_quantity,
  frozen_quantity = excluded.frozen_quantity,
  leftover_proposed_quantity = excluded.leftover_proposed_quantity,
  leftover_confirmed_quantity = excluded.leftover_confirmed_quantity,
  is_extra = excluded.is_extra,
  order_created_at = excluded.order_created_at,
  order_created_by_name = excluded.order_created_by_name,
  updated_at = excluded.updated_at;

insert into public.production_plans (
  id, production_date, status, created_by, created_by_name, updated_at
)
values (
  '54000000-0000-4000-8000-000000000002',
  (now() at time zone 'America/Sao_Paulo')::date,
  'aguardando_geolar',
  '94000000-0000-4000-8000-000000000001',
  'Rodrigo Teste',
  now()
)
on conflict (production_date) do update set
  status = excluded.status,
  created_by = excluded.created_by,
  created_by_name = excluded.created_by_name,
  updated_at = excluded.updated_at;

insert into public.production_plan_items (
  id, plan_id, store, bread_id, planned_quantity, frozen_quantity,
  leftover_proposed_quantity, leftover_confirmed_quantity, is_extra,
  order_created_at, order_created_by_name, updated_at
)
select
  '55000000-0000-4000-8000-000000000002',
  plan.id,
  'jc',
  'teste-ciabatta',
  10,
  8,
  2,
  2,
  false,
  null,
  null,
  now()
from public.production_plans plan
where plan.production_date = (now() at time zone 'America/Sao_Paulo')::date
on conflict (plan_id, store, bread_id) do update set
  planned_quantity = excluded.planned_quantity,
  frozen_quantity = excluded.frozen_quantity,
  leftover_proposed_quantity = excluded.leftover_proposed_quantity,
  leftover_confirmed_quantity = excluded.leftover_confirmed_quantity,
  is_extra = excluded.is_extra,
  order_created_at = excluded.order_created_at,
  order_created_by_name = excluded.order_created_by_name,
  updated_at = excluded.updated_at;

with test_schedule as (
  select (
    (now() at time zone 'America/Sao_Paulo')::date
    + case extract(dow from (now() at time zone 'America/Sao_Paulo')::date)
        when 0 then 1
        when 1 then 1
        when 2 then 1
        when 3 then 1
        when 4 then 2
        when 5 then 1
        when 6 then 2
      end::integer
  ) as production_date
), test_admin as (
  select id
  from auth.users
  where lower(email) = 'rodrigao+teste@gmail.com'
)
insert into public.bread_reuse_plans (
  id, target_production_date, store, bread_id, proposed_quantity,
  confirmed_quantity, status, proposed_by, proposed_by_name, updated_at
)
select
  '56000000-0000-4000-8000-000000000001',
  production_date,
  'jc',
  'teste-baguete',
  2,
  null,
  'proposed',
  test_admin.id,
  'Rodrigo Teste',
  now()
from test_schedule
cross join test_admin
on conflict (target_production_date, store, bread_id) do update set
  proposed_quantity = excluded.proposed_quantity,
  confirmed_quantity = excluded.confirmed_quantity,
  status = excluded.status,
  proposed_by = excluded.proposed_by,
  proposed_by_name = excluded.proposed_by_name,
  updated_at = excluded.updated_at;

insert into public.romaneios (
  id, record_date, destination_id, trip_number, status, created_by, obs, sent_by, sent_at
)
values
  (
    '40000000-0000-4000-8000-000000000002',
    (now() at time zone 'America/Sao_Paulo')::date,
    '20000000-0000-4000-8000-000000000003',
    2,
    'com_divergencia',
    'Rodrigo Teste',
    '[TESTE] viagem EX com reposicao pendente',
    'Expedicao JC Teste',
    (now() at time zone 'America/Sao_Paulo') - interval '20 minutes'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    (now() at time zone 'America/Sao_Paulo')::date,
    '20000000-0000-4000-8000-000000000003',
    4,
    'separado',
    'Rodrigo Teste',
    '[TESTE] viagem EX visivel para a entregadora',
    null,
    null
  ),
  (
    '40000000-0000-4000-8000-000000000005',
    (now() at time zone 'America/Sao_Paulo')::date,
    '20000000-0000-4000-8000-000000000003',
    5,
    'enviado',
    'Rodrigo Teste',
    '[TESTE] viagem EX pendente de conferencia',
    'Expedicao JC Teste',
    (now() at time zone 'America/Sao_Paulo') - interval '10 minutes'
  )
on conflict (id) do update set
  record_date = excluded.record_date,
  destination_id = excluded.destination_id,
  trip_number = excluded.trip_number,
  status = excluded.status,
  created_by = excluded.created_by,
  obs = excluded.obs,
  sent_by = excluded.sent_by,
  sent_at = excluded.sent_at,
  confirmed_by = null,
  confirmed_at = null;

insert into public.romaneio_items (
  id,
  romaneio_id,
  product_id,
  product_source,
  product_name,
  qty_sent,
  qty_received,
  qty_accepted,
  unit_price,
  divergence_reason,
  item_status
)
values
  (
    '41000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002',
    'teste-baguete',
    'bread',
    '[TESTE] Baguete',
    10,
    8,
    8,
    1,
    '[TESTE] faltou na contagem fisica',
    'divergencia'
  ),
  (
    '41000000-0000-4000-8000-000000000005',
    '40000000-0000-4000-8000-000000000005',
    'teste-baguete',
    'bread',
    '[TESTE] Baguete',
    8,
    null,
    null,
    1,
    null,
    'pendente'
  )
on conflict (id) do update set
  romaneio_id = excluded.romaneio_id,
  product_id = excluded.product_id,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  qty_sent = excluded.qty_sent,
  qty_received = excluded.qty_received,
  qty_accepted = excluded.qty_accepted,
  unit_price = excluded.unit_price,
  divergence_reason = excluded.divergence_reason,
  item_status = excluded.item_status;

insert into public.romaneio_replacement_pending (
  id,
  destination_id,
  source_romaneio_id,
  source_item_id,
  product_id,
  product_source,
  product_name,
  pending_quantity,
  status,
  created_by
)
values (
  '42000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000002',
  '41000000-0000-4000-8000-000000000002',
  'teste-baguete',
  'bread',
  '[TESTE] Baguete',
  2,
  'aberta',
  'Rodrigo Teste'
)
on conflict (source_item_id) do update set
  pending_quantity = excluded.pending_quantity,
  status = excluded.status,
  updated_at = now();

-- Cobrancas ficticias do Contas a receber: uma atrasada e uma a vencer, para a
-- tela nascer com os dois estados visiveis. As datas sao relativas ao dia da
-- reconstrucao para o cenario nao envelhecer (licao rerun-navegador-exige-seed-do-dia).
--
-- Nao ha cobranca ja recebida de proposito: baixar uma delas e o teste que o
-- Rodrigo executa no preview, e e ele que prova a ponte com o livro-caixa.
with hoje as (
  select (now() at time zone 'America/Sao_Paulo')::date as dia
), categoria as (
  select id from public.finance_categories where key = 'clientes_pj'
), autor as (
  select id from auth.users where lower(email) = 'rodrigao+teste-financeiro-jc@gmail.com'
), fixture (id, request_id, customer_id, dias_atras, valor, descricao) as (
  values
    ('90000000-0000-4000-8000-000000000001'::uuid, '90000000-0000-4000-8000-0000000000a1'::uuid,
     '60000000-0000-4000-8000-000000000001'::uuid, 40, 1240.00, '[TESTE] Paes da semana - cobranca atrasada'),
    ('90000000-0000-4000-8000-000000000002'::uuid, '90000000-0000-4000-8000-0000000000a2'::uuid,
     '60000000-0000-4000-8000-000000000001'::uuid, 5, 860.50, '[TESTE] Paes da semana - cobranca a vencer')
)
insert into public.receivables (
  id, request_id, customer_id, origin, finance_category_id, description,
  invoice_date, original_due_date, due_date, amount, status, created_by
)
select
  fixture.id, fixture.request_id, fixture.customer_id, 'avulso', categoria.id, fixture.descricao,
  hoje.dia - fixture.dias_atras,
  hoje.dia - fixture.dias_atras + customer.payment_term_days,
  hoje.dia - fixture.dias_atras + customer.payment_term_days,
  fixture.valor, 'aberta', autor.id
from fixture
cross join hoje
cross join categoria
cross join autor
join public.customers customer on customer.id = fixture.customer_id
on conflict (id) do update set
  invoice_date = excluded.invoice_date,
  original_due_date = excluded.original_due_date,
  due_date = excluded.due_date,
  amount = excluded.amount,
  description = excluded.description,
  status = 'aberta',
  -- O recebimento deixou de morar na cobranca: agora sao os pedacos em
  -- receivable_receipts, apagados logo abaixo.
  cancel_reason = null,
  cancelled_by = null,
  cancelled_at = null;

delete from public.receivable_events
where receivable_id in (
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002'
);

-- Cobranca semeada volta ao estado inicial: sem nenhum pedaco recebido.
delete from public.receivable_receipts
where receivable_id in (
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002'
);

insert into public.receivable_events (receivable_id, event_type, details, created_by)
select cobranca.id, 'lancada',
       jsonb_build_object('amount', cobranca.amount, 'due_date', cobranca.due_date, 'origin', 'avulso'),
       cobranca.created_by
from public.receivables cobranca
where cobranca.id in (
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002'
);

-- Cenario da Buck (EX) para a fase 4 do Contas a receber.
--
-- Sem cliente, tabela de preco e romaneios da EX, a tela de Romaneios abre
-- vazia e nao ha o que cobrar. As datas ficam afastadas do dia da
-- reconstrucao pelo mesmo motivo do cenario PJ (licao
-- seed-com-hoje-vence-a-meia-noite).
insert into public.customers (id, name, doc, payment_term_days, active, notes)
values ('60000000-0000-4000-8000-000000000009', 'Buck', null, 15, true,
        'Cliente ficticio da EX para validar a conta semanal.')
on conflict (id) do update set
  name = excluded.name,
  payment_term_days = excluded.payment_term_days,
  active = excluded.active,
  notes = excluded.notes;

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values ('teste-ciabatta-buck', '[TESTE] Ciabatta Buck', '{0,1,2,3,4,5,6}', true, 'kg', false, false)
on conflict (id) do update set name = excluded.name, active = excluded.active, unit = excluded.unit;

insert into public.price_tiers (id, name, description, active)
values ('50000000-0000-4000-8000-000000000002', 'BUCK',
        'Precos ficticios da EX para validar a conta semanal da Buck.', true)
on conflict (id) do update set
  name = excluded.name, description = excluded.description, active = excluded.active;

insert into public.price_tier_items (
  id, tier_id, product_id, product_source, product_name, unit_price, pricing_unit, pack_size, active
) values
  -- Por unidade: 150 un x 1,20 = 180,00.
  ('51000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000002',
   'teste-brioche-pj', 'bread', '[TESTE] Brioche PJ', 1.20, 'un', 1, true),
  -- Por quilo, porque o nome tem ciabatta: 3,5 kg x 38,00 = 133,00.
  ('51000000-0000-4000-8000-000000000012', '50000000-0000-4000-8000-000000000002',
   'teste-ciabatta-buck', 'bread', '[TESTE] Ciabatta Buck', 38.00, 'kg', 1, true),
  -- A Baguete tambem viaja para a EX nos romaneios de outros cenarios. Sem
  -- preco aqui, ela bloquearia a geracao e o caminho feliz nunca apareceria.
  ('51000000-0000-4000-8000-000000000013', '50000000-0000-4000-8000-000000000002',
   'teste-baguete', 'bread', '[TESTE] Baguete', 2.50, 'un', 1, true)
on conflict (id) do update set
  tier_id = excluded.tier_id,
  product_id = excluded.product_id,
  product_source = excluded.product_source,
  product_name = excluded.product_name,
  unit_price = excluded.unit_price,
  pricing_unit = excluded.pricing_unit,
  active = excluded.active;

insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
select '72000000-0000-4000-8000-000000000001', d.id,
       (now() at time zone 'America/Sao_Paulo')::date - 5, 1, 'enviado', 'Expedicao JC Teste'
from public.destinations d where upper(d.code) = 'EX'
on conflict (id) do update set
  record_date = excluded.record_date, status = excluded.status;

insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
select '72000000-0000-4000-8000-000000000002', d.id,
       (now() at time zone 'America/Sao_Paulo')::date - 3, 1, 'enviado', 'Expedicao JC Teste'
from public.destinations d where upper(d.code) = 'EX'
on conflict (id) do update set
  record_date = excluded.record_date, status = excluded.status;

-- Total do cenario: 180,00 + 133,00 = 313,00.
insert into public.romaneio_items (
  id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted
) values
  ('73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001',
   'teste-brioche-pj', 'bread', '[TESTE] Brioche PJ', 100, null),
  ('73000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000002',
   'teste-brioche-pj', 'bread', '[TESTE] Brioche PJ', 60, 50),
  ('73000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000001',
   'teste-ciabatta-buck', 'bread', '[TESTE] Ciabatta Buck', 3.5, null)
on conflict (id) do update set
  qty_sent = excluded.qty_sent,
  qty_accepted = excluded.qty_accepted,
  product_name = excluded.product_name;

-- ---------------------------------------------------------------------------
-- Cenario de historico para a media de saida no planejamento de producao.
--
-- O card de cada pao mostra quanto saiu de JC e JA no MESMO dia da semana da
-- data planejada, usando ate 8 ocorrencias validas em 12 semanas. Sem um
-- historico assim, o Banco Preview so consegue exibir "sem historico
-- suficiente" e o teste humano nao prova numero nenhum.
--
-- O pao abaixo existe so para isso e nao entra em nenhum outro cenario: as
-- datas ficam semanas atras, longe do "hoje menos 3/5" usado pelos demais.
--
-- Numeros escolhidos para que o teste tenha o que conferir:
--   JC envia 20 e sobram 4  -> saiu 16 em todas as semanas
--   JA envia 10 e sobram 2  -> saiu 8, MENOS na 3a e na 7a semana, em que a
--                              JA nao registra fechamento (dia descartado)
-- Esperado na tela: JC 16, JA 8, total 24, com a contagem de dias validos
-- diferente entre as duas lojas.
-- ---------------------------------------------------------------------------

insert into public.breads (id, name, days, active, unit, is_special, is_shelf)
values ('teste-historico', '[TESTE] Pao com Historico', '{0,1,2,3,4,5,6}', true, 'un', false, false)
on conflict (id) do update set
  name = excluded.name, active = excluded.active, unit = excluded.unit, days = excluded.days;

with semanas as (
  select generate_series(1, 12) as n
), alvos as (
  -- Cobre o dia de hoje e o de amanha: o planejamento costuma ser montado
  -- para o dia seguinte, mas o teste pode abrir qualquer um dos dois.
  select n, offset_dia,
         ((now() at time zone 'America/Sao_Paulo')::date + offset_dia - (n * 7)) as record_date
  from semanas cross join (values (0), (1)) as dias(offset_dia)
), destinos as (
  select id, lower(code) as loja from public.destinations where lower(code) in ('jc', 'ja')
), planejado as (
  select a.n, a.offset_dia, a.record_date, d.id as destination_id, d.loja,
         -- uuid so aceita 0-9 e a-f: n vai ate 12 e offset ate 1, ambos em hex.
         ('7f' || case when d.loja = 'jc' then 'c' else 'a' end
            || '00000-0000-4000-8000-0000000000'
            || lpad(to_hex(a.n * 2 + a.offset_dia), 2, '0'))::uuid as romaneio_id,
         case when d.loja = 'jc' then 20 else 10 end as qty_sent,
         case when d.loja = 'jc' then 4 else 2 end as qty_leftover,
         -- A JA nao registra fechamento na 3a e na 7a semana: e o buraco que
         -- o card precisa mostrar como dia descartado, e nao como sobra zero.
         (d.loja = 'jc' or a.n not in (3, 7)) as registra_fechamento
  from alvos a cross join destinos d
)
insert into public.romaneios (id, destination_id, record_date, trip_number, status, created_by)
select romaneio_id, destination_id, record_date, 1, 'enviado', 'Expedicao JC Teste'
from planejado
on conflict (id) do update set
  destination_id = excluded.destination_id,
  record_date = excluded.record_date,
  status = excluded.status;

with semanas as (
  select generate_series(1, 12) as n
), alvos as (
  select n, offset_dia,
         ((now() at time zone 'America/Sao_Paulo')::date + offset_dia - (n * 7)) as record_date
  from semanas cross join (values (0), (1)) as dias(offset_dia)
), destinos as (
  select id, lower(code) as loja from public.destinations where lower(code) in ('jc', 'ja')
), planejado as (
  select a.n, a.offset_dia, a.record_date, d.loja,
         ('7f' || case when d.loja = 'jc' then 'c' else 'a' end
            || '00000-0000-4000-8000-0000000000'
            || lpad(to_hex(a.n * 2 + a.offset_dia), 2, '0'))::uuid as romaneio_id,
         ('7e' || case when d.loja = 'jc' then 'c' else 'a' end
            || '00000-0000-4000-8000-0000000000'
            || lpad(to_hex(a.n * 2 + a.offset_dia), 2, '0'))::uuid as item_id,
         case when d.loja = 'jc' then 20 else 10 end as qty_sent
  from alvos a cross join destinos d
)
insert into public.romaneio_items (
  id, romaneio_id, product_id, product_source, product_name, qty_sent, qty_accepted
)
select item_id, romaneio_id, 'teste-historico', 'bread', '[TESTE] Pao com Historico', qty_sent, null
from planejado
on conflict (id) do update set
  qty_sent = excluded.qty_sent,
  product_name = excluded.product_name;

with semanas as (
  select generate_series(1, 12) as n
), alvos as (
  select n, offset_dia,
         ((now() at time zone 'America/Sao_Paulo')::date + offset_dia - (n * 7)) as record_date
  from semanas cross join (values (0), (1)) as dias(offset_dia)
), lojas as (
  select unnest(array['jc', 'ja']) as loja
), planejado as (
  select a.n, a.offset_dia, a.record_date, l.loja,
         ('7d' || case when l.loja = 'jc' then 'c' else 'a' end
            || '00000-0000-4000-8000-0000000000'
            || lpad(to_hex(a.n * 2 + a.offset_dia), 2, '0'))::uuid as sobra_id,
         case when l.loja = 'jc' then 4 else 2 end as quantidade
  from alvos a cross join lojas l
  where l.loja = 'jc' or a.n not in (3, 7)
)
insert into public.sobras (
  id, record_date, responsible, product_id, quantity, obs,
  product_source, store, lot_code, pending_quantity, status,
  physical_location, reconciliation_status, updated_at
)
select
  sobra_id, record_date, 'Fechamento Teste', 'teste-historico', quantidade,
  '[TESTE] fechamento historico para a media de saida no planejamento',
  'bread', loja, 'L' || to_char(record_date, 'MMDD'), 0, 'resolved',
  'balcao_fechamento', 'not_required', now()
from planejado
on conflict (id) do update set
  record_date = excluded.record_date,
  quantity = excluded.quantity,
  store = excluded.store,
  lot_code = excluded.lot_code,
  pending_quantity = excluded.pending_quantity,
  status = excluded.status,
  reconciliation_status = excluded.reconciliation_status,
  updated_at = excluded.updated_at;
