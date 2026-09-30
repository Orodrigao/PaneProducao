-- Configuração do Sistema, fase 1 da formação de preço (docs/FORMACAO_DE_PRECO.md).
--
-- Rodrigo decidiu em 2026-09-29 que imposto, taxa de cada canal e margens são
-- padrão único do negócio, guardados numa página de Configuração do Sistema
-- que só o admin vê e muda. Esta migration cria o lugar onde esses números
-- moram; nenhuma tela existente os lê. Quem os consome é a fase 3 (ficha
-- técnica que salva).
--
-- Desenho:
--
--   - Um histórico só de inserção (private.pricing_settings_history). Cada
--     salvamento grava uma linha nova por valor que mudou; o valor vigente é a
--     linha mais recente da mesma chave. Nada é sobrescrito, então "quem mudou
--     e quando" e o valor anterior saem do próprio histórico.
--   - A chave é (parâmetro, canal, categoria). Imposto não tem canal nem
--     categoria; taxa tem canal; margem desejada e mínima têm canal e, quando
--     é exceção, a categoria de produto (lista controlada, só produto
--     fabricado ou de revenda).
--   - Valor nulo é "não definido" e nunca vira zero. Ninguém decidiu as
--     margens ainda (os 65/45/25 de setembro foram chute), então nada nasce
--     preenchido.
--   - A tabela fica no esquema private, sem grant para ninguém, e o acesso
--     passa por duas funções que conferem admin ativo no banco. Esconder a tela
--     do menu não protege nada (lição leitura-operacional-sem-preco): Compras e
--     Financeiro recebem recusa do banco mesmo chamando a API com a URL certa.
--   - Canais: não existe campo "canal" no sistema. O conjunto é fechado
--     (balcao, ifood, buck) e o mapa de rótulos vive em
--     src/lib/pricingSettings.ts, que precisa concordar com os checks abaixo.
--   - A ordem das versões usa clock_timestamp(), nunca now(): now() é o início
--     da transação e empataria todas as linhas de um mesmo salvamento.
--
-- Reversão: as tabelas novas não são lidas por nenhuma tela existente.
-- Desligar é tirar o item do menu; remover o objeto é migration nova.

begin;

create table private.pricing_settings_history (
  id bigint generated always as identity primary key,
  setting_key text not null check (setting_key in (
    'imposto_venda',
    'taxa_canal',
    'margem_desejada',
    'margem_minima'
  )),
  channel text check (channel in ('balcao', 'ifood', 'buck')),
  category_id uuid references public.product_categories(id) on delete restrict,
  value numeric(5, 2) check (value is null or value between 0 and 100),
  change_id uuid not null,
  changed_at timestamptz not null default pg_catalog.clock_timestamp(),
  -- Sem chave estrangeira para auth.users de propósito: o histórico precisa
  -- sobreviver à saída de quem mudou. O nome fica copiado no momento da
  -- gravação, como no restante do ERP.
  changed_by uuid not null,
  changed_by_name text not null,
  constraint pricing_settings_history_scope_check check (
    (setting_key = 'imposto_venda' and channel is null and category_id is null)
    or (setting_key = 'taxa_canal' and channel is not null and category_id is null)
    or (setting_key in ('margem_desejada', 'margem_minima') and channel is not null)
  )
);

create index pricing_settings_history_key_idx
  on private.pricing_settings_history (setting_key, channel, category_id, changed_at desc, id desc);

alter table private.pricing_settings_history enable row level security;
alter table private.pricing_settings_history force row level security;
revoke all on table private.pricing_settings_history from public, anon, authenticated, service_role;

-- O passado não se reescreve: nem as funções deste arquivo nem código futuro
-- conseguem alterar ou apagar uma versão gravada.
create function private.pricing_settings_history_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501',
    message = 'O histórico da Configuração do Sistema só aceita novas versões.';
end;
$$;
revoke all on function private.pricing_settings_history_append_only()
  from public, anon, authenticated, service_role;

create trigger pricing_settings_history_append_only
  before update or delete or truncate on private.pricing_settings_history
  for each statement execute function private.pricing_settings_history_append_only();

-- Valor vigente de cada chave. Interna: a fase 3 lê por aqui, de dentro de
-- outra função que confere o próprio acesso. DISTINCT ON trata nulos como
-- iguais, então imposto (sem canal nem categoria) tem uma chave só.
create function private.pricing_settings_current()
returns table (
  cfg_setting_key text,
  cfg_channel text,
  cfg_category_id uuid,
  cfg_value numeric,
  cfg_changed_at timestamptz,
  cfg_changed_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (history.setting_key, history.channel, history.category_id)
    history.setting_key,
    history.channel,
    history.category_id,
    history.value,
    history.changed_at,
    history.changed_by_name
  from private.pricing_settings_history history
  order by history.setting_key, history.channel, history.category_id,
    history.changed_at desc, history.id desc;
$$;
revoke all on function private.pricing_settings_current()
  from public, anon, authenticated, service_role;

-- Leitura da tela: valores vigentes e o histórico mais recente, com o valor
-- anterior de cada versão. Só admin ativo.
create function public.get_pricing_settings(p_history_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_current jsonb;
  v_history jsonb;
begin
  if not (select private.current_user_is_access_admin()) then
    raise exception using errcode = '42501',
      message = 'Somente administradores podem ver a Configuração do Sistema.';
  end if;

  if p_history_limit is null or p_history_limit not between 1 and 1000 then
    raise exception using errcode = '22023',
      message = 'O limite do histórico deve estar entre 1 e 1000.';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'setting_key', current_value.cfg_setting_key,
      'channel', current_value.cfg_channel,
      'category_id', current_value.cfg_category_id,
      'value', current_value.cfg_value,
      'changed_at', current_value.cfg_changed_at,
      'changed_by_name', current_value.cfg_changed_by_name
    ) order by current_value.cfg_setting_key, current_value.cfg_channel, current_value.cfg_category_id), '[]'::jsonb)
    into v_current
    from private.pricing_settings_current() current_value;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', versioned.id,
      'setting_key', versioned.setting_key,
      'channel', versioned.channel,
      'category_id', versioned.category_id,
      'category_name', category.name,
      'previous_value', versioned.previous_value,
      'value', versioned.value,
      'changed_at', versioned.changed_at,
      'changed_by_name', versioned.changed_by_name
    ) order by versioned.changed_at desc, versioned.id desc), '[]'::jsonb)
    into v_history
    from (
      select
        history.*,
        pg_catalog.lag(history.value) over (
          partition by history.setting_key, history.channel, history.category_id
          order by history.changed_at, history.id
        ) as previous_value
      from private.pricing_settings_history history
      order by history.changed_at desc, history.id desc
      limit p_history_limit
    ) versioned
    left join public.product_categories category on category.id = versioned.category_id;

  return pg_catalog.jsonb_build_object('current', v_current, 'history', v_history);
end;
$$;
revoke all on function public.get_pricing_settings(integer) from public, anon, service_role;
grant execute on function public.get_pricing_settings(integer) to authenticated;

-- Gravação. Recebe só os valores que mudaram na tela, cada um com o valor que
-- a tela mostrava antes (previous_value):
--
--   - valor igual ao vigente não grava nada, então o segundo toque em Salvar
--     não cria versão repetida;
--   - vigente diferente do que a tela mostrava significa que outro salvamento
--     entrou no meio; recusa em vez de atropelar;
--   - qualquer item inválido recusa o salvamento inteiro.
create function public.save_pricing_settings(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_name text;
  v_change_id uuid := pg_catalog.gen_random_uuid();
  v_item jsonb;
  v_key text;
  v_channel text;
  v_category_id uuid;
  v_value numeric;
  v_previous numeric;
  v_current numeric;
  v_catalog_type text;
  v_seen text[] := array[]::text[];
  v_identity text;
  v_saved integer := 0;
begin
  if not (select private.current_user_is_access_admin()) then
    raise exception using errcode = '42501',
      message = 'Somente administradores podem mudar a Configuração do Sistema.';
  end if;

  select profile.display_name into v_actor_name
    from public.app_profiles profile
   where profile.user_id = v_actor;

  if p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'array' then
    raise exception using errcode = '22023', message = 'Envie a lista de valores alterados.';
  end if;
  if pg_catalog.jsonb_array_length(p_changes) > 500 then
    raise exception using errcode = '22023', message = 'Valores demais num salvamento só.';
  end if;

  -- Um salvamento por vez: dois admins (ou dois toques) não intercalam a
  -- leitura do vigente com a gravação da versão nova. Leitura não espera.
  lock table private.pricing_settings_history in share row exclusive mode;

  for v_item in select item.value from pg_catalog.jsonb_array_elements(p_changes) as item(value) loop
    if pg_catalog.jsonb_typeof(v_item) <> 'object'
       or not (v_item ? 'setting_key' and v_item ? 'value' and v_item ? 'previous_value') then
      raise exception using errcode = '22023', message = 'Valor alterado em formato inválido.';
    end if;

    if pg_catalog.jsonb_typeof(v_item -> 'setting_key') <> 'string' then
      raise exception using errcode = '22023', message = 'Parâmetro inválido.';
    end if;
    v_key := v_item ->> 'setting_key';
    if v_key not in ('imposto_venda', 'taxa_canal', 'margem_desejada', 'margem_minima') then
      raise exception using errcode = '22023', message = 'Parâmetro inválido.';
    end if;

    v_channel := null;
    if v_item ? 'channel' and pg_catalog.jsonb_typeof(v_item -> 'channel') <> 'null' then
      if pg_catalog.jsonb_typeof(v_item -> 'channel') <> 'string'
         or (v_item ->> 'channel') not in ('balcao', 'ifood', 'buck') then
        raise exception using errcode = '22023', message = 'Canal inválido.';
      end if;
      v_channel := v_item ->> 'channel';
    end if;

    v_category_id := null;
    if v_item ? 'category_id' and pg_catalog.jsonb_typeof(v_item -> 'category_id') <> 'null' then
      if pg_catalog.jsonb_typeof(v_item -> 'category_id') <> 'string'
         or (v_item ->> 'category_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = 'Categoria inválida.';
      end if;
      v_category_id := (v_item ->> 'category_id')::uuid;
      select category.catalog_type into v_catalog_type
        from public.product_categories category
       where category.id = v_category_id;
      if v_catalog_type is null or v_catalog_type not in ('produto_fabricado', 'produto_revenda') then
        raise exception using errcode = '22023',
          message = 'A exceção de margem vale só para categoria de produto fabricado ou de revenda.';
      end if;
    end if;

    if (v_key = 'imposto_venda' and (v_channel is not null or v_category_id is not null))
       or (v_key = 'taxa_canal' and (v_channel is null or v_category_id is not null))
       or (v_key in ('margem_desejada', 'margem_minima') and v_channel is null) then
      raise exception using errcode = '22023',
        message = 'Imposto vale para todos os canais; taxa é por canal; margem é por canal, com exceção opcional por categoria.';
    end if;

    v_identity := v_key || '|' || coalesce(v_channel, '') || '|' || coalesce(v_category_id::text, '');
    if v_identity = any(v_seen) then
      raise exception using errcode = '22023', message = 'O mesmo valor veio duas vezes no salvamento.';
    end if;
    v_seen := v_seen || v_identity;

    v_value := null;
    if pg_catalog.jsonb_typeof(v_item -> 'value') = 'number' then
      v_value := (v_item ->> 'value')::numeric;
    elsif pg_catalog.jsonb_typeof(v_item -> 'value') <> 'null' then
      raise exception using errcode = '22023', message = 'Percentual deve ser número ou vazio.';
    end if;
    if v_value is not null and (v_value < 0 or v_value > 100 or v_value <> pg_catalog.round(v_value, 2)) then
      raise exception using errcode = '22023',
        message = 'Percentual deve ficar entre 0 e 100, com até duas casas decimais.';
    end if;

    v_previous := null;
    if pg_catalog.jsonb_typeof(v_item -> 'previous_value') = 'number' then
      v_previous := (v_item ->> 'previous_value')::numeric;
    elsif pg_catalog.jsonb_typeof(v_item -> 'previous_value') <> 'null' then
      raise exception using errcode = '22023', message = 'Valor anterior em formato inválido.';
    end if;

    select current_value.cfg_value into v_current
      from private.pricing_settings_current() current_value
     where current_value.cfg_setting_key = v_key
       and current_value.cfg_channel is not distinct from v_channel
       and current_value.cfg_category_id is not distinct from v_category_id;
    if not found then
      v_current := null;
    end if;

    if v_current is not distinct from v_value then
      continue;
    end if;
    if v_current is distinct from v_previous then
      raise exception using errcode = '40001',
        message = 'Outro salvamento mudou a configuração depois que a tela abriu. Recarregue a página para ver os valores atuais.';
    end if;

    insert into private.pricing_settings_history (
      setting_key, channel, category_id, value, change_id, changed_by, changed_by_name
    ) values (
      v_key, v_channel, v_category_id, v_value, v_change_id, v_actor, coalesce(v_actor_name, 'Sem nome')
    );
    v_saved := v_saved + 1;
  end loop;

  -- Margem mínima acima da desejada, no mesmo canal e categoria, não faz
  -- sentido. Confere o estado final inteiro, não só o que veio agora.
  if exists (
    select 1
      from private.pricing_settings_current() minimum
      join private.pricing_settings_current() desired
        on desired.cfg_setting_key = 'margem_desejada'
       and desired.cfg_channel is not distinct from minimum.cfg_channel
       and desired.cfg_category_id is not distinct from minimum.cfg_category_id
     where minimum.cfg_setting_key = 'margem_minima'
       and minimum.cfg_value is not null
       and desired.cfg_value is not null
       and minimum.cfg_value > desired.cfg_value
  ) then
    raise exception using errcode = '22023',
      message = 'A margem mínima não pode ser maior que a margem desejada do mesmo canal.';
  end if;

  return pg_catalog.jsonb_build_object(
    'change_id', case when v_saved > 0 then v_change_id end,
    'saved', v_saved
  );
end;
$$;
revoke all on function public.save_pricing_settings(jsonb) from public, anon, service_role;
grant execute on function public.save_pricing_settings(jsonb) to authenticated;

commit;
