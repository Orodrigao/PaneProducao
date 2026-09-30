-- Configuração do Sistema: conflito de salvamento sem repetição infinita.
--
-- A migration 20260930012316 recusava "outro salvamento entrou no meio" com o
-- código 40001 (serialization_failure). O PostgREST trata esse código como
-- falha transitória e repete a transação sozinho; como o conflito é o estado
-- gravado e não muda entre as tentativas, a chamada ficava presa para sempre,
-- segurando conexão e a trava da tabela. Visto no teste do preview da PR 467
-- em 2026-09-29: a tela ficou em "Salvando..." até outro salvamento desfazer o
-- conflito. O pgTAP não pega isso, porque roda direto no banco, sem PostgREST.
--
-- A recusa passa a usar PT409, código próprio que o PostgREST devolve como
-- HTTP 409 sem repetir. A função é redefinida a partir da versão da migration
-- anterior (mesmo arquivo de PR, com a herança de margem da exceção); a única
-- diferença é o código do conflito.

begin;

create or replace function public.save_pricing_settings(p_changes jsonb)
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
  -- CANARIO: trava de admin removida de proposito. Nunca integrar.

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
      raise exception using errcode = 'PT409',
        message = 'Outro salvamento mudou a configuração depois que a tela abriu. Recarregue a página para ver os valores atuais.';
    end if;

    insert into private.pricing_settings_history (
      setting_key, channel, category_id, value, change_id, changed_by, changed_by_name
    ) values (
      v_key, v_channel, v_category_id, v_value, v_change_id, v_actor, coalesce(v_actor_name, 'Sem nome')
    );
    v_saved := v_saved + 1;
  end loop;

  -- Margem mínima acima da desejada não faz sentido. A comparação é pelo valor
  -- que vale de fato: numa exceção de categoria, o campo vazio herda o do
  -- canal (é o que a tela promete). Assim, mínima de exceção acima da desejada
  -- do canal, ou desejada de exceção abaixo da mínima do canal, também é
  -- recusada. Confere o estado final inteiro, não só o que veio agora.
  if exists (
    with vigente as (
      select * from private.pricing_settings_current()
    ),
    escopo as (
      select canal.channel, null::uuid as category_id
        from pg_catalog.unnest(array['balcao', 'ifood', 'buck']) as canal(channel)
      union
      select vigente.cfg_channel, vigente.cfg_category_id
        from vigente
       where vigente.cfg_category_id is not null
    ),
    efetivo as (
      select
        coalesce(
          (select vigente.cfg_value from vigente
            where vigente.cfg_setting_key = 'margem_desejada' and vigente.cfg_channel = escopo.channel
              and vigente.cfg_category_id is not distinct from escopo.category_id),
          (select vigente.cfg_value from vigente
            where vigente.cfg_setting_key = 'margem_desejada' and vigente.cfg_channel = escopo.channel
              and vigente.cfg_category_id is null)
        ) as desired,
        coalesce(
          (select vigente.cfg_value from vigente
            where vigente.cfg_setting_key = 'margem_minima' and vigente.cfg_channel = escopo.channel
              and vigente.cfg_category_id is not distinct from escopo.category_id),
          (select vigente.cfg_value from vigente
            where vigente.cfg_setting_key = 'margem_minima' and vigente.cfg_channel = escopo.channel
              and vigente.cfg_category_id is null)
        ) as minimum
      from escopo
    )
    select 1 from efetivo
     where efetivo.minimum is not null
       and efetivo.desired is not null
       and efetivo.minimum > efetivo.desired
  ) then
    raise exception using errcode = '22023',
      message = 'A margem mínima não pode ser maior que a margem desejada que vale para o mesmo canal e categoria (campo vazio na exceção usa o valor do canal).';
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
