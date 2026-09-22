-- Fase 2A do catálogo: a lista controlada nasce preenchida e o cadastro
-- existente passa a apontar para ela.
--
-- A fase 1 (PR #318) criou public.product_categories, os nove tipos de item e
-- as colunas products.catalog_type e products.category_id, mas nada foi
-- preenchido: a lista ficou vazia e nenhum produto foi classificado. A PR #432
-- unificou o texto livre de products.category em 20 grafias limpas, e é isso
-- que torna esta migration possível sem tela de classificação item a item:
-- cada uma das 20 vira uma categoria controlada, e o produto encontra a sua
-- pela mesma chave normalizada que a lista já usa. A vigésima primeira,
-- Serviços, nasce aqui para receber a taxa de tele-entrega.
--
-- O tipo de item de cada categoria foi decidido pelo Rodrigo em 2026-09-22:
-- Insumos é matéria-prima; Embalagens, Higiene e limpeza, Escritório e
-- Manutenção vão para os tipos de mesmo nome; Revenda é produto de revenda; e
-- as catorze categorias de venda são produto fabricado. Os seis produtos
-- marcados como kit no cadastro (kind = 'kit') seguem a categoria de pão onde
-- já estão, porque quem responde "isto é um kit" hoje é products.kind: criar
-- uma segunda fonte para a mesma pergunta é como as grafias repetidas
-- nasceram. Os tipos utensilio_equipamento e kit continuam existindo, sem
-- categoria, até a operação precisar deles.
--
-- Duas travas fecham em vez de adivinhar, porque classificar metade do
-- catálogo em silêncio é pior que recusar a migration:
--
--   1. se alguma das 21 já existir na lista com outro tipo ou inativa, a
--      migration aborta. Sem isso, uma categoria criada pela tela com o tipo
--      errado seria reaproveitada e arrastaria centenas de produtos com ela;
--   2. se sobrar produto cuja categoria não tem correspondente na lista, a
--      migration aborta. As grafias vieram de leitura ao vivo do cadastro;
--      se uma delas não bater (um espaço, um "e" no lugar de "&"), os produtos
--      daquela categoria ficariam sem classificação e nada avisaria.
--
-- Em banco limpo (CI Banco e banco por PR) a segunda trava passa de graça,
-- porque o seed roda depois das migrations e não há produto nenhum aqui. Ela
-- existe para produção. Quem prova a regra dela é o pgTAP da frente, que
-- chama private.product_categories_without_match() diretamente.
--
-- Reversão, nesta ordem obrigatória, sempre por migration nova (SQL manual em
-- produção é proibido pelo AGENTS.md):
--
--   update public.products product
--      set catalog_type = registro.old_catalog_type,
--          category_id = registro.old_category_id
--     from private.product_catalog_assignment_log registro
--    where product.id = registro.product_id
--      and registro.run_label = '2026-09-22-fase-2a'
--      and product.catalog_type = registro.new_catalog_type
--      and product.category_id = registro.new_category_id;
--   delete from public.product_categories where ...;
--
-- A condição pelos valores novos existe para não atropelar decisão tomada
-- depois; a ordem existe porque a chave estrangeira é on delete restrict e
-- recusa apagar categoria ainda em uso.
--
-- O gatilho sync_site_bread_catalog publica pão no site e reage a UPDATE OF
-- name, category, active, sort_order, kind, is_fabricacao_propria, is_pj,
-- production_days, production_area. A classificação escreve só catalog_type e
-- category_id, que estão fora dessa lista; o teste da frente lê a definição do
-- gatilho e prova que essas duas colunas não o acordam. A correção de
-- categoria logo abaixo escreve, sim, em category e acorda o gatilho, mas
-- nenhum dos dez itens é pão: são limpeza e industrializados de revenda, e o
-- teste prova que a vitrine do site fica igual.

begin;

-- Um décimo tipo de item: serviço.
--
-- A padaria cobra tele-entrega por um "produto" chamado Tele, que a Elis criou
-- para lançar o frete do cliente. Ele vive em Confeitaria e nenhuma das nove
-- gavetas da fase 1 serve para ele: não é matéria-prima, não é fabricado, não
-- é revenda. Classificá-lo como produto fabricado misturaria frete com doce em
-- todo agrupamento por tipo. Rodrigo decidiu em 2026-09-22 criar a gaveta em
-- vez de forçar o item numa errada; ela serve para qualquer taxa futura.
--
-- O tipo existe em três lugares que precisam concordar: o check de
-- product_categories, o check de products e a validação dentro de
-- manage_product_category. Fora do banco, existe também em CATALOG_TYPES, em
-- src/lib/productCategories.ts, alterado no mesmo commit.
alter table public.product_categories
  drop constraint product_categories_catalog_type_check;
alter table public.product_categories
  add constraint product_categories_catalog_type_check check (catalog_type in (
    'materia_prima',
    'embalagem',
    'higiene_limpeza',
    'escritorio_administrativo',
    'utensilio_equipamento',
    'manutencao',
    'produto_fabricado',
    'produto_revenda',
    'kit',
    'servico'
  ));

alter table public.products
  drop constraint products_catalog_type_check;
alter table public.products
  add constraint products_catalog_type_check check (
    catalog_type is null or catalog_type in (
      'materia_prima',
      'embalagem',
      'higiene_limpeza',
      'escritorio_administrativo',
      'utensilio_equipamento',
      'manutencao',
      'produto_fabricado',
      'produto_revenda',
      'kit',
      'servico'
    )
  );

-- Redefinida a partir da versão vigente (20260902181827), com o tipo novo na
-- validação. Nada mais muda: `create or replace` sobrescreve o corpo inteiro,
-- então a diferença tem que ser só esta.
create or replace function public.manage_product_category(
  p_name text,
  p_catalog_type text,
  p_id uuid default null,
  p_active boolean default true,
  p_sort_order integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := pg_catalog.btrim(p_name);
begin
  if not (select private.current_user_is_access_admin()) then
    raise exception using errcode = '42501', message = 'Somente administradores podem gerenciar categorias de produtos.';
  end if;

  if v_name is null or char_length(v_name) not between 2 and 80 then
    raise exception using errcode = '22023', message = 'Informe um nome de categoria entre 2 e 80 caracteres.';
  end if;
  if private.normalize_product_category_name(v_name) = '' then
    raise exception using errcode = '22023', message = 'O nome da categoria precisa conter letras ou números.';
  end if;
  if p_catalog_type is null or p_catalog_type not in (
    'materia_prima', 'embalagem', 'higiene_limpeza', 'escritorio_administrativo',
    'utensilio_equipamento', 'manutencao', 'produto_fabricado', 'produto_revenda',
    'kit', 'servico'
  ) then
    raise exception using errcode = '22023', message = 'Tipo de item inválido.';
  end if;
  if p_sort_order is null or p_sort_order not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'A ordem deve estar entre 0 e 10000.';
  end if;

  if p_id is null then
    insert into public.product_categories (name, catalog_type, active, sort_order)
    values (v_name, p_catalog_type, coalesce(p_active, true), p_sort_order)
    returning id into v_id;
  else
    if exists (
      select 1 from public.products product
      where product.category_id = p_id
        and product.catalog_type is distinct from p_catalog_type
    ) then
      raise exception using errcode = '23503',
        message = 'Não é possível trocar o tipo de uma categoria já usada por produtos.';
    end if;

    update public.product_categories category
    set name = v_name,
        catalog_type = p_catalog_type,
        active = coalesce(p_active, category.active),
        sort_order = p_sort_order,
        updated_at = now()
    where category.id = p_id
    returning category.id into v_id;

    if v_id is null then
      raise exception using errcode = 'P0002', message = 'Categoria de produto não encontrada.';
    end if;
  end if;

  return v_id;
exception
  when unique_violation then
    raise exception using errcode = '23505',
      message = 'Já existe uma categoria com esse nome, mesmo considerando acentos e maiúsculas.';
end;
$$;

revoke all on function public.manage_product_category(text, text, uuid, boolean, integer)
  from public, anon, service_role;
grant execute on function public.manage_product_category(text, text, uuid, boolean, integer)
  to authenticated;

-- Antes de classificar, dois grupos de itens que estavam na categoria errada.
-- Rodrigo decidiu em 2026-09-22, olhando o cadastro item a item:
--
--   - Manutenção guardava cinco itens de limpeza (detergente, escova de roupa,
--     lã de aço, palha de aço e luva nitrílica). É o mesmo caso da luva de
--     látex, que a PR #432 já mandou para Higiene e limpeza. Sobra na
--     Manutenção só a chave do toalheiro, que é manutenção de verdade;
--   - cinco industrializados dentro de Insumos já estavam marcados com
--     is_revenda: goma de mascar, café em pacote, muffin pronto e dois
--     chocolates Trento. Contavam como matéria-prima no custo de produção.
--
-- Corrigir aqui, e não depois, é de propósito: a classificação abaixo segue o
-- texto da categoria. Trocar o texto depois deixaria o produto com a categoria
-- nova escrita e a gaveta antiga amarrada, que é exatamente a divergência que
-- esta fase registra como risco.
--
-- O registro vai para private.product_category_unification_log, o mesmo da
-- PR #432: é a mesma natureza de mudança (texto livre da categoria) e a
-- reversão fica num lugar só.
create or replace function private.move_misfiled_legacy_categories()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  with item_moves (source_category, product_name, new_category) as (
    -- Casa por nome E pela categoria de origem, como a unificação: não arrasta
    -- homônimo de outro grupo, e rodando de novo o item que já saiu não é
    -- movido outra vez.
    values
      ('Manutenção', 'DETERGENTE NEUTRO 5L AGELIMP', 'Higiene e limpeza'),
      ('Manutenção', 'ESCOVA DE ROUPA COM ALCA', 'Higiene e limpeza'),
      ('Manutenção', 'LA DE ACO C/8', 'Higiene e limpeza'),
      ('Manutenção', 'PALHA DE ACO', 'Higiene e limpeza'),
      ('Manutenção', 'LUVA NITRILICA SEM PO M/8 PRETA 100 UN', 'Higiene e limpeza'),
      ('Insumos', '3L MINT GOMA FRESH 15X8,5GR', 'Revenda'),
      ('Insumos', 'CAFE CASABLANCA MOIDO EXTRAFORTE - PCTE 500GRS', 'Revenda'),
      ('Insumos', 'MUFFIN BAUNILHA GOTAS MB 15 X 80G', 'Revenda'),
      ('Insumos', 'TRENTO CHOCOLATE BRANCO 29GR DP. 16X29GR', 'Revenda'),
      ('Insumos', 'TRENTO DUO 29GR DP. 16X29GR', 'Revenda'),
      -- A taxa de tele-entrega sai de Confeitaria para a categoria de serviço.
      ('Confeitaria', 'TELE', 'Serviços')
  ),
  changed as (
    update public.products product
    set category = item_move.new_category
    from item_moves item_move
    where item_move.source_category = product.category
      and item_move.product_name = pg_catalog.upper(pg_catalog.btrim(product.name))
      and product.category is distinct from item_move.new_category
    returning product.id, item_move.source_category, item_move.new_category
  ),
  logged as (
    insert into private.product_category_unification_log (product_id, old_category, new_category)
    select changed.id, changed.source_category, changed.new_category
    from changed
    returning 1
  )
  select pg_catalog.count(*) into v_changed from logged;

  return v_changed;
end;
$$;

revoke all on function private.move_misfiled_legacy_categories()
  from public, anon, authenticated, service_role;

select private.move_misfiled_legacy_categories();

-- A lista decidida vive numa tabela temporária porque é usada duas vezes: no
-- seed e na trava de tipo. Repetir os 20 nomes seria criar a chance de eles
-- discordarem entre si.
create temporary table categorias_decididas (
  nome text not null,
  tipo text not null,
  ordem integer not null
) on commit drop;

insert into categorias_decididas (nome, tipo, ordem) values
  ('Insumos', 'materia_prima', 10),
  ('Embalagens', 'embalagem', 10),
  ('Higiene e limpeza', 'higiene_limpeza', 10),
  ('Escritório', 'escritorio_administrativo', 10),
  ('Manutenção', 'manutencao', 10),
  ('Revenda', 'produto_revenda', 10),
  -- Produto fabricado em ordem de uso na padaria, não alfabética: quem
  -- cadastra item novo abre a lista atrás de pão muito mais vezes que atrás
  -- de sopa.
  ('Pães', 'produto_fabricado', 10),
  ('Pães Branco', 'produto_fabricado', 20),
  ('Pães Integ.', 'produto_fabricado', 30),
  ('Pães Recheados', 'produto_fabricado', 40),
  ('Croissant', 'produto_fabricado', 50),
  ('Focaccias', 'produto_fabricado', 60),
  ('Pizza Romana', 'produto_fabricado', 70),
  ('Pizza Redonda', 'produto_fabricado', 80),
  ('Bruschettas', 'produto_fabricado', 90),
  ('Lanches', 'produto_fabricado', 100),
  ('Salgados', 'produto_fabricado', 110),
  ('Sopas & Cremes', 'produto_fabricado', 120),
  ('Pastas & Pesto', 'produto_fabricado', 130),
  ('Confeitaria', 'produto_fabricado', 140),
  ('Serviços', 'servico', 10);

-- 1. A lista controlada recebe as categorias que o cadastro já usa.
--    Quem decide se uma categoria já existe é a chave normalizada, a mesma do
--    índice único da tabela: assim rodar de novo não tenta inserir duplicata
--    nem depende do nome ter sido escrito com o mesmo acento.
insert into public.product_categories (name, catalog_type, sort_order)
select decidida.nome, decidida.tipo, decidida.ordem
from categorias_decididas decidida
where not exists (
  select 1
  from public.product_categories existing
  where existing.normalized_name = private.normalize_product_category_name(decidida.nome)
);

-- Trava 1: categoria pré-existente precisa concordar com a decisão. O insert
-- acima pula a linha que já existe, e uma linha criada pela tela com o tipo
-- errado passaria despercebida arrastando todos os produtos daquele nome.
do $$
declare
  v_divergentes text;
begin
  select pg_catalog.string_agg(
      existing.name || ' (é ' || existing.catalog_type
        || case when existing.active then '' else ', inativa' end
        || ', deveria ser ' || decidida.tipo || ')', '; ' order by existing.name)
    into v_divergentes
  from categorias_decididas decidida
  join public.product_categories existing
    on existing.normalized_name = private.normalize_product_category_name(decidida.nome)
  where existing.catalog_type is distinct from decidida.tipo
     or not existing.active;

  if v_divergentes is not null then
    raise exception using errcode = '23514',
      message = 'Categoria já cadastrada diverge da decisão desta fase; classificação abortada: ' || v_divergentes;
  end if;
end $$;

create table private.product_catalog_assignment_log (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  run_label text not null,
  old_catalog_type text,
  old_category_id uuid,
  new_catalog_type text not null,
  new_category_id uuid not null,
  assigned_at timestamptz not null default now()
);

comment on table private.product_catalog_assignment_log is
  'Registro das classificações automáticas de tipo e categoria controlada; run_label separa as rodadas e permite devolver o valor anterior.';
comment on column private.product_catalog_assignment_log.run_label is
  'Rodada que gravou a linha. A função classifica de novo em fases seguintes, e desfazer uma rodada não pode desfazer as outras.';

-- Produto apagado leva sua linha junto: não existe classificação a reverter
-- num produto que não existe mais.
alter table private.product_catalog_assignment_log enable row level security;
alter table private.product_catalog_assignment_log force row level security;
revoke all on table private.product_catalog_assignment_log
  from public, anon, authenticated, service_role;

-- Sem policy nenhuma, a RLS forçada só não barra o dono da tabela, que tem
-- BYPASSRLS. É o mesmo desenho do registro da unificação: quem escreve aqui é
-- a função abaixo, executada pela Action; nenhum cliente alcança a tabela.

-- Lista as categorias em texto livre que ficariam sem correspondente na lista
-- controlada. Existe para a trava da migration ter regra testável: uma trava
-- que só roda em produção não pode ser a única definição do próprio critério.
create or replace function private.product_categories_without_match()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct product.category
  from public.products product
  where product.catalog_type is null
    and product.category_id is null
    and not exists (
      select 1
      from public.product_categories category
      where category.active
        and category.normalized_name = private.normalize_product_category_name(product.category)
    )
  order by 1;
$$;

revoke all on function private.product_categories_without_match()
  from public, anon, authenticated, service_role;

-- Classifica pelo nome da categoria em texto livre. Só toca produto que está
-- sem tipo E sem categoria: decisão já registrada por alguém, inclusive uma
-- feita depois desta migration, não é sobrescrita. Por isso a função é segura
-- para rodar de novo, e a fase seguinte pode reaproveitá-la para os produtos
-- que chegarem antes de a tela exigir a escolha. A migration inteira não é
-- reexecutável (o create table falha na segunda vez); a função é.
create or replace function private.assign_controlled_product_categories(
  p_run_label text default '2026-09-22-fase-2a'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  with target as (
    select
      product.id,
      product.catalog_type as old_catalog_type,
      product.category_id as old_category_id,
      category.id as new_category_id,
      category.catalog_type as new_catalog_type
    from public.products product
    join public.product_categories category
      on category.normalized_name = private.normalize_product_category_name(product.category)
    where product.category_id is null
      and product.catalog_type is null
      and category.active
  ),
  changed as (
    update public.products product
    set catalog_type = target.new_catalog_type,
        category_id = target.new_category_id
    from target
    where product.id = target.id
      -- Repetido de propósito, e não só dentro da CTE acima. Em read
      -- committed, quando este update espera o lock de outra transação e ela
      -- commita, o Postgres reavalia só a condição deste where contra a linha
      -- viva; o filtro que mora na CTE ficou preso ao snapshot antigo. Sem
      -- estas duas linhas, uma escolha salva na tela durante a janela da
      -- migration seria sobrescrita, e o registro guardaria "estava em branco"
      -- quando não estava.
      and product.category_id is null
      and product.catalog_type is null
    returning
      product.id,
      target.old_catalog_type,
      target.old_category_id,
      target.new_catalog_type,
      target.new_category_id
  ),
  logged as (
    insert into private.product_catalog_assignment_log (
      product_id, run_label, old_catalog_type, old_category_id, new_catalog_type, new_category_id
    )
    select
      changed.id,
      p_run_label,
      changed.old_catalog_type,
      changed.old_category_id,
      changed.new_catalog_type,
      changed.new_category_id
    from changed
    returning 1
  )
  select pg_catalog.count(*) into v_changed from logged;

  return v_changed;
end;
$$;

-- O Postgres concede EXECUTE a PUBLIC em toda função nova, e anon herda isso.
revoke all on function private.assign_controlled_product_categories(text)
  from public, anon, authenticated, service_role;

select private.assign_controlled_product_categories();

-- Trava 2: nenhum produto pode sobrar com categoria fora da lista.
do $$
declare
  v_orfas text;
begin
  select pg_catalog.string_agg(categoria, '; ' order by categoria)
    into v_orfas
  from private.product_categories_without_match() as categoria;

  if v_orfas is not null then
    raise exception using errcode = '23514',
      message = 'Categoria em uso no cadastro não existe na lista controlada; classificação abortada: ' || v_orfas;
  end if;
end $$;

commit;
