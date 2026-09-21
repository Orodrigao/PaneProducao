-- Contagem semanal de estoque, fase 2 (JC).
--
-- Fase 1 (PR #427) so diagnosticou se o cadastro estava pronto para contar
-- (unidade, custo, conversao). Esta fase grava a contagem em si: nada aqui
-- calcula consumo ou CMV, e as tabelas antigas stock_balance/stock_entries/
-- stock_movements continuam intocadas por decisao do Rodrigo (nunca reaproveitadas
-- e nunca usadas para baixa automatica de estoque).
--
-- Fluxo aprovado por Rodrigo em 2026-09-20:
--   * Rodrigo marca no cadastro (Produtos) quais insumos entram na contagem
--     semanal -- um subconjunto, nao os ~300 ja classificados.
--   * Expedicao (Rafaela, JC) e admin digitam a quantidade contada; cada valor
--     salva sozinho, entao a contagem sobrevive a app fechado/reaberto.
--   * "Fechar contagem" trava os numeros; so admin reabre.
--
-- Revisao adversarial do Sol (2026-09-20) apontou que a primeira versao nao
-- tinha identidade de semana (dava para fechar e abrir outra na mesma semana,
-- criando duas contagens "oficiais") e montava a lista de itens em tempo real
-- a partir do cadastro (produto desmarcado no meio da semana sumia da tela
-- mesmo ja contado). Esta versao corrige os dois pontos: a contagem e
-- identificada por loja + semana (unique real, nao so "uma aberta por vez"),
-- e a lista de itens e fotografada no momento de abrir.
--
-- Toda escrita passa por RPC `security definer`: nenhuma tabela nova recebe
-- INSERT/UPDATE direto da Data API, para que quem conta, quem fecha e quem
-- reabre nunca varie por porta de entrada (licao `validar-tambem-na-saida`).

begin;

-- ---------------------------------------------------------------------------
-- Cadastro: quais insumos entram na contagem semanal.
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists weekly_count_enabled boolean not null default false;

alter table public.products
  drop constraint if exists products_weekly_count_requer_insumo_ativo;
alter table public.products
  add constraint products_weekly_count_requer_insumo_ativo
    check (not weekly_count_enabled or (kind = 'insumo' and active));

-- Repete no banco a mesma lista de unidades reconhecidas de
-- src/lib/inventoryReadiness.ts (UNIT_ALIASES), sem acentuacao porque o
-- cadastro real ja guarda as unidades sem acento (confirmado: as 347 linhas
-- ativas de kind='insumo' em producao tem unidade reconhecida pela fase 1).
-- Se a lista de aliases mudar no codigo, esta trava precisa acompanhar.
alter table public.products
  drop constraint if exists products_weekly_count_requer_unidade_reconhecida;
alter table public.products
  add constraint products_weekly_count_requer_unidade_reconhecida
    check (
      not weekly_count_enabled
      or (
        -- unit is not null é obrigatório aqui: um CHECK com NULL no meio da
        -- expressão passa (nem true nem false), então "unit is null" driblava
        -- a trava inteira sem essa checagem explícita (achado do CodeRabbit).
        unit is not null
        and lower(trim(unit)) = any(array[
        'kg','kilo','quilo','quilos','quilograma','quilogramas',
        'g','gr','grama','gramas',
        'l','lt','litro','litros',
        'ml','mililitro','mililitros',
        'un','und','unidade','unidades','pc','peca','pecas','peça','peças',
        'pct','pacote','pacotes',
        'cx','caixa','caixas',
        'fd','fardo','fardos'
        ])
      )
    );

comment on column public.products.weekly_count_enabled is
  'Marcado por quem edita o catalogo: insumo entra na contagem semanal de estoque (fase 2). So vale para insumo ativo com unidade reconhecida.';

-- ---------------------------------------------------------------------------
-- A contagem da semana e seus itens.
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_weekly_counts (
  id uuid primary key default gen_random_uuid(),
  -- Fase 2 e so JC; ampliar para outra loja e migration nova, nao troca de dado.
  store text not null check (store = 'jc'),
  -- Segunda-feira da semana operacional que contem o sabado da contagem.
  -- E a identidade da rodada: no maximo uma contagem por loja e semana,
  -- fechada ou aberta. Sem isso, fechar e abrir de novo criava duas
  -- contagens igualmente "oficiais" na mesma semana (achado do Sol).
  week_start date not null,
  status text not null default 'aberta' check (status in ('aberta', 'fechada')),
  opened_at timestamptz not null default now(),
  opened_by uuid not null references auth.users(id),
  opened_by_name text not null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  closed_by_name text,
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id),
  reopened_by_name text,
  created_at timestamptz not null default now()
);

comment on table public.inventory_weekly_counts is
  'Uma rodada de contagem fisica semanal por loja, identificada por loja+semana. Nao calcula consumo nem CMV: so registra o que foi contado.';

create unique index if not exists inventory_weekly_counts_uma_por_loja_semana
  on public.inventory_weekly_counts (store, week_start);

create index if not exists inventory_weekly_counts_por_loja_data
  on public.inventory_weekly_counts (store, opened_at desc);

create table if not exists public.inventory_weekly_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inventory_weekly_counts(id) on delete cascade,
  product_id uuid not null references public.products(id),
  -- null = ainda nao contado; >=0 = contado (zero e uma contagem valida).
  quantity numeric(10, 3),
  -- Copia da unidade do produto no momento da abertura: se o cadastro mudar a
  -- unidade depois, o numero ja contado continua legivel no seu contexto original.
  unit text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_by_name text,
  constraint inventory_weekly_count_items_quantidade_nao_negativa
    check (quantity is null or quantity >= 0)
);

create unique index if not exists inventory_weekly_count_items_um_por_produto
  on public.inventory_weekly_count_items (count_id, product_id);

comment on table public.inventory_weekly_count_items is
  'Fotografia dos insumos marcados no momento em que a contagem da semana abriu. Escrita exclusiva das RPCs open/save_inventory_weekly_count.';

-- ---------------------------------------------------------------------------
-- RLS: leitura para quem ja acessa /estoque hoje; escrita so pelas RPCs.
-- ---------------------------------------------------------------------------
alter table public.inventory_weekly_counts enable row level security;
alter table public.inventory_weekly_counts force row level security;

drop policy if exists inventory_weekly_counts_select on public.inventory_weekly_counts;
create policy inventory_weekly_counts_select
on public.inventory_weekly_counts
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role in ('admin', 'financeiro', 'estoque', 'compras', 'expedicao')
  )
);

revoke all on table public.inventory_weekly_counts from public, anon, authenticated;
grant select on table public.inventory_weekly_counts to authenticated;

alter table public.inventory_weekly_count_items enable row level security;
alter table public.inventory_weekly_count_items force row level security;

drop policy if exists inventory_weekly_count_items_select on public.inventory_weekly_count_items;
create policy inventory_weekly_count_items_select
on public.inventory_weekly_count_items
for select
to authenticated
using (
  exists (
    select 1
    from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active
      and profile.role in ('admin', 'financeiro', 'estoque', 'compras', 'expedicao')
  )
);

revoke all on table public.inventory_weekly_count_items from public, anon, authenticated;
grant select on table public.inventory_weekly_count_items to authenticated;

-- ---------------------------------------------------------------------------
-- Catalogo de permissao granular: quem pode contar/fechar, alem do admin.
-- ---------------------------------------------------------------------------
insert into public.app_permissions ("key", "module", "label", "description", "sort_order")
values (
  'estoque.contar_semanal',
  'Operacao',
  'Contar estoque semanal',
  'Registrar e fechar a contagem semanal de insumos da JC.',
  95
)
on conflict ("key") do update set
  "module" = excluded."module",
  "label" = excluded."label",
  "description" = excluded."description",
  "sort_order" = excluded."sort_order";

-- ---------------------------------------------------------------------------
-- Quem pode contar: admin sempre; expedicao de JC com a permissao concedida.
-- ---------------------------------------------------------------------------
create or replace function private.pode_contar_estoque_semanal(p_store text)
returns table (user_id uuid, display_name text)
language sql
stable
set search_path = ''
as $$
  select profile.user_id, profile.display_name
  from public.app_profiles profile
  where profile.user_id = (select auth.uid())
    and profile.active
    and (
      profile.role = 'admin'
      or (
        profile.role = 'expedicao'
        and profile.store = p_store
        and exists (
          select 1
          from public.app_user_permissions assignment
          where assignment.user_id = profile.user_id
            and assignment.permission_key = 'estoque.contar_semanal'
            and assignment.scope in ('*', p_store)
        )
      )
    );
$$;

revoke all on function private.pode_contar_estoque_semanal(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Abrir a contagem da semana atual: cria a rodada e fotografa a lista.
-- ---------------------------------------------------------------------------
-- So cria uma contagem nova quando a semana ainda nao tem nenhuma. Se a
-- semana atual ja tem contagem aberta, devolve ela (idempotente). Se ja tem
-- contagem fechada, RECUSA: quem decide reabrir e o admin, por
-- reopen_inventory_weekly_count, nunca esta funcao.
create or replace function public.open_inventory_weekly_count(p_store text default 'jc')
returns public.inventory_weekly_counts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_week_start date;
  v_count public.inventory_weekly_counts;
begin
  if p_store is distinct from 'jc' then
    raise exception using errcode = '22023', message = 'Contagem semanal so existe para a JC nesta fase.';
  end if;

  select autorizado.user_id, autorizado.display_name
  into v_user_id, v_user_name
  from private.pode_contar_estoque_semanal(p_store) autorizado;

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Sem permissao para abrir a contagem semanal.';
  end if;

  v_week_start := pg_catalog.date_trunc('week', private.data_na_padaria())::date;

  -- Duas aberturas simultaneas da mesma loja/semana disputariam o indice
  -- unico com erro cru; a trava serializa e a segunda chamada so encontra a
  -- contagem que a primeira acabou de criar (mesmo padrao de
  -- private.lock_financial_request).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('paneerp:inventory-weekly-count:' || p_store || ':' || v_week_start::text, 0)
  );

  select * into v_count
  from public.inventory_weekly_counts existing
  where existing.store = p_store
    and existing.week_start = v_week_start;

  if v_count.id is not null then
    if v_count.status = 'fechada' then
      raise exception using errcode = '22023',
        message = 'A contagem desta semana ja foi fechada. Peca para o admin reabrir para corrigir.';
    end if;
    return v_count;
  end if;

  insert into public.inventory_weekly_counts (store, week_start, opened_by, opened_by_name)
  values (p_store, v_week_start, v_user_id, v_user_name)
  returning * into v_count;

  -- Fotografa agora quem entra nesta rodada. Produto marcado ou desmarcado
  -- depois deste instante nao muda a lista desta semana (achado do Sol):
  -- comeca a valer na proxima abertura.
  insert into public.inventory_weekly_count_items (count_id, product_id, unit)
  select v_count.id, product_row.id, product_row.unit
  from public.products product_row
  where product_row.weekly_count_enabled
    and product_row.active
    and product_row.kind = 'insumo';

  return v_count;
end;
$$;

revoke all on function public.open_inventory_weekly_count(text) from public, anon;
grant execute on function public.open_inventory_weekly_count(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Salvar a quantidade contada de um insumo ja fotografado na rodada.
-- ---------------------------------------------------------------------------
create or replace function public.save_inventory_weekly_count_item(
  p_count_id uuid,
  p_product_id uuid,
  p_quantity numeric
)
returns public.inventory_weekly_count_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_store text;
  v_status text;
  v_item public.inventory_weekly_count_items;
begin
  if p_count_id is null or p_product_id is null then
    raise exception using errcode = '22023', message = 'Contagem e insumo sao obrigatorios.';
  end if;

  if p_quantity is not null and p_quantity < 0 then
    raise exception using errcode = '22023', message = 'Quantidade contada nao pode ser negativa.';
  end if;

  select count_row.store, count_row.status
  into v_store, v_status
  from public.inventory_weekly_counts count_row
  where count_row.id = p_count_id
  for update;

  if v_store is null then
    raise exception using errcode = 'P0002', message = 'Contagem semanal nao encontrada.';
  end if;

  select autorizado.user_id, autorizado.display_name
  into v_user_id, v_user_name
  from private.pode_contar_estoque_semanal(v_store) autorizado;

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Sem permissao para contar nesta loja.';
  end if;

  if v_status <> 'aberta' then
    raise exception using errcode = '22023',
      message = 'Esta contagem ja foi fechada. Peca para o admin reabrir antes de corrigir.';
  end if;

  -- O insumo precisa fazer parte da fotografia tirada na abertura. Marcar um
  -- insumo novo no cadastro no meio da semana nao o insere nesta rodada
  -- (achado do Sol) -- ele entra a partir da proxima abertura.
  update public.inventory_weekly_count_items
  set quantity = p_quantity,
      updated_at = now(),
      updated_by = v_user_id,
      updated_by_name = v_user_name
  where count_id = p_count_id
    and product_id = p_product_id
  returning * into v_item;

  if v_item.id is null then
    raise exception using errcode = '22023', message = 'Este insumo nao faz parte da contagem desta semana.';
  end if;

  return v_item;
end;
$$;

revoke all on function public.save_inventory_weekly_count_item(uuid, uuid, numeric) from public, anon;
grant execute on function public.save_inventory_weekly_count_item(uuid, uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Fechar a contagem: trava os numeros da semana.
-- ---------------------------------------------------------------------------
create or replace function public.close_inventory_weekly_count(p_count_id uuid)
returns public.inventory_weekly_counts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_store text;
  v_status text;
  v_count public.inventory_weekly_counts;
begin
  if p_count_id is null then
    raise exception using errcode = '22023', message = 'Contagem obrigatoria.';
  end if;

  select count_row.store, count_row.status
  into v_store, v_status
  from public.inventory_weekly_counts count_row
  where count_row.id = p_count_id
  for update;

  if v_store is null then
    raise exception using errcode = 'P0002', message = 'Contagem semanal nao encontrada.';
  end if;

  select autorizado.user_id, autorizado.display_name
  into v_user_id, v_user_name
  from private.pode_contar_estoque_semanal(v_store) autorizado;

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Sem permissao para fechar esta contagem.';
  end if;

  if v_status = 'fechada' then
    select * into v_count from public.inventory_weekly_counts where id = p_count_id;
    return v_count;
  end if;

  update public.inventory_weekly_counts
  set status = 'fechada',
      closed_at = now(),
      closed_by = v_user_id,
      closed_by_name = v_user_name
  where id = p_count_id
  returning * into v_count;

  return v_count;
end;
$$;

revoke all on function public.close_inventory_weekly_count(uuid) from public, anon;
grant execute on function public.close_inventory_weekly_count(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reabrir: exclusivo do admin.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_inventory_weekly_count(p_count_id uuid)
returns public.inventory_weekly_counts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_user_name text;
  v_store text;
  v_week_start date;
  v_status text;
  v_count public.inventory_weekly_counts;
begin
  if p_count_id is null then
    raise exception using errcode = '22023', message = 'Contagem obrigatoria.';
  end if;

  select profile.user_id, profile.display_name
  into v_user_id, v_user_name
  from public.app_profiles profile
  where profile.user_id = (select auth.uid())
    and profile.active
    and profile.role = 'admin';

  if v_user_id is null then
    raise exception using errcode = '42501', message = 'So o admin pode reabrir uma contagem fechada.';
  end if;

  select count_row.store, count_row.week_start, count_row.status
  into v_store, v_week_start, v_status
  from public.inventory_weekly_counts count_row
  where count_row.id = p_count_id
  for update;

  if v_status is null then
    raise exception using errcode = 'P0002', message = 'Contagem semanal nao encontrada.';
  end if;

  -- Mesma trava de abrir: por loja+semana, nao existe caminho para colidir
  -- com o indice unico (so ha uma linha por loja+semana), mas a trava mantém
  -- abrir e reabrir simetricos e cobertos pelo mesmo teste de concorrencia.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('paneerp:inventory-weekly-count:' || v_store || ':' || v_week_start::text, 0)
  );

  if v_status = 'aberta' then
    select * into v_count from public.inventory_weekly_counts where id = p_count_id;
    return v_count;
  end if;

  update public.inventory_weekly_counts
  set status = 'aberta',
      reopened_at = now(),
      reopened_by = v_user_id,
      reopened_by_name = v_user_name
  where id = p_count_id
  returning * into v_count;

  return v_count;
end;
$$;

revoke all on function public.reopen_inventory_weekly_count(uuid) from public, anon;
grant execute on function public.reopen_inventory_weekly_count(uuid) to authenticated;

commit;
