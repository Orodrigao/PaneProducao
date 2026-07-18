-- Fundacao aditiva para permissoes explicitas por usuario.
-- Nao altera allowed_routes, role, store ou active.

create schema if not exists private;

create or replace function private.current_user_is_access_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.app_profiles profile
    where profile.user_id = (select auth.uid())
      and profile.active and profile.role = 'admin'
  );
$$;

revoke all on function private.current_user_is_access_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.current_user_is_access_admin() to authenticated;

create table public.app_permissions (
  key text primary key,
  module text not null,
  label text not null,
  description text,
  sort_order integer not null default 0,
  constraint app_permissions_key_format check (key ~ '^[a-z0-9_]+\.[a-z0-9_]+$')
);

create table public.app_user_permissions (
  user_id uuid not null references public.app_profiles(user_id) on delete cascade,
  permission_key text not null references public.app_permissions(key) on delete cascade,
  scope text not null default '*',
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, permission_key, scope),
  constraint app_user_permissions_scope check (scope in ('*', 'jc', 'ja', 'ex'))
);

alter table public.app_permissions enable row level security;
alter table public.app_permissions force row level security;
alter table public.app_user_permissions enable row level security;
alter table public.app_user_permissions force row level security;

revoke all on table public.app_permissions from anon, authenticated;
revoke all on table public.app_user_permissions from anon, authenticated;
grant select on table public.app_permissions to authenticated;
grant select, insert, delete on table public.app_user_permissions to authenticated;

create policy app_permissions_select_authenticated on public.app_permissions
for select to authenticated using (
  exists (
    select 1 from public.app_profiles profile
    where profile.user_id = (select auth.uid()) and profile.active
  )
);

create policy app_user_permissions_select_own_or_admin on public.app_user_permissions
for select to authenticated using (
  user_id = (select auth.uid()) or (select private.current_user_is_access_admin())
);

create policy app_user_permissions_insert_admin on public.app_user_permissions
for insert to authenticated with check (
  (select private.current_user_is_access_admin()) and granted_by = (select auth.uid())
);

create policy app_user_permissions_delete_admin on public.app_user_permissions
for delete to authenticated using ((select private.current_user_is_access_admin()));

create policy app_profiles_select_access_admin on public.app_profiles
for select to authenticated using ((select private.current_user_is_access_admin()));

insert into public.app_permissions (key, module, label, description, sort_order)
values
  ('producao.acessar', 'Operacao', 'Producao', 'Acessar a tela de producao.', 10),
  ('forno.acessar', 'Operacao', 'Forno', 'Acessar o fluxo do forno.', 20),
  ('romaneio.acessar', 'Operacao', 'Romaneio', 'Acessar romaneios. Acoes detalhadas serao ativadas depois.', 30),
  ('relatorios.acessar', 'Operacao', 'Relatorios', 'Acessar relatorios operacionais.', 40),
  ('sobras.acessar', 'Operacao', 'Sobras', 'Registrar e consultar sobras.', 50),
  ('caixa.acessar', 'Operacao', 'Caixa', 'Acessar fechamento de caixa.', 60),
  ('congelado.acessar', 'Operacao', 'Congelado', 'Acessar estoque congelado.', 70),
  ('saldo_paes.acessar', 'Operacao', 'Saldo de Paes', 'Acessar saldo de paes.', 80),
  ('estoque.acessar', 'Operacao', 'Estoque', 'Acessar estoque de insumos.', 90),
  ('compras.acessar', 'Comercial', 'Compras', 'Acessar listas de compras.', 110),
  ('cotacoes.acessar', 'Comercial', 'Cotacoes', 'Acessar cotacoes.', 120),
  ('fornecedores.acessar', 'Comercial', 'Fornecedores', 'Acessar fornecedores.', 130),
  ('produtos.acessar', 'Comercial', 'Produtos', 'Acessar produtos.', 140),
  ('clientes.acessar', 'Comercial', 'Clientes', 'Acessar clientes.', 150),
  ('pedidos_pj.acessar', 'Comercial', 'Pedidos PJ', 'Acessar pedidos PJ.', 160),
  ('encomendas.acessar', 'Comercial', 'Encomendas', 'Acessar encomendas.', 170),
  ('tabelas_preco.acessar', 'Gestao', 'Tabelas de preco', 'Acessar tabelas de preco.', 210),
  ('simulador.acessar', 'Gestao', 'Simulador', 'Acessar simulador de desconto.', 220),
  ('usuarios.gerenciar', 'Administracao', 'Usuarios', 'Preparar permissoes de usuarios.', 310);

with route_permissions(route, permission_key) as (
  values
    ('/', 'producao.acessar'), ('/forno', 'forno.acessar'),
    ('/romaneio', 'romaneio.acessar'), ('/relatorios', 'relatorios.acessar'),
    ('/relatorios/sobras-descartes', 'relatorios.acessar'), ('/sobras', 'sobras.acessar'),
    ('/fechamento-caixa', 'caixa.acessar'), ('/estoque-congelado', 'congelado.acessar'),
    ('/estoque-paes', 'saldo_paes.acessar'), ('/estoque', 'estoque.acessar'),
    ('/compras', 'compras.acessar'), ('/cotacoes', 'cotacoes.acessar'),
    ('/fornecedores', 'fornecedores.acessar'), ('/produtos', 'produtos.acessar'),
    ('/clientes', 'clientes.acessar'), ('/pedidos-pj', 'pedidos_pj.acessar'),
    ('/encomendas', 'encomendas.acessar'), ('/tabelas-preco', 'tabelas_preco.acessar'),
    ('/simulador-desconto', 'simulador.acessar')
)
insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select distinct profile.user_id, mapping.permission_key, '*', null
from public.app_profiles profile
cross join lateral jsonb_array_elements_text(profile.allowed_routes) allowed_route(route)
join route_permissions mapping on mapping.route = allowed_route.route
where profile.active
on conflict do nothing;

insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
select profile.user_id, permission.key, '*', null
from public.app_profiles profile cross join public.app_permissions permission
where profile.active and profile.role = 'admin'
on conflict do nothing;

-- Ajustes individuais nao pertencem ao backfill: nomes podem mudar e nao sao
-- identificadores unicos. A tela administrativa salva essas escolhas usando o
-- user_id da sessao autenticada, depois que a matriz preservada for conferida.

create or replace function public.replace_user_permissions(
  p_user_id uuid,
  p_permission_keys text[]
)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  if p_user_id is null then raise exception 'Usuario obrigatorio'; end if;

  if exists (
    select 1
    from unnest(coalesce(p_permission_keys, array[]::text[])) requested(key)
    left join public.app_permissions permission on permission.key = requested.key
    where permission.key is null
  ) then
    raise exception 'Permissao desconhecida';
  end if;

  delete from public.app_user_permissions where user_id = p_user_id;

  insert into public.app_user_permissions (user_id, permission_key, scope, granted_by)
  select p_user_id, requested.key, '*', (select auth.uid())
  from (select distinct unnest(coalesce(p_permission_keys, array[]::text[])) as key) requested;
end;
$$;

revoke all on function public.replace_user_permissions(uuid, text[]) from public, anon;
grant execute on function public.replace_user_permissions(uuid, text[]) to authenticated;
