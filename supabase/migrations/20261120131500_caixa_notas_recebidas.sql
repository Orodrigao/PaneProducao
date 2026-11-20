-- Caixa de notas recebidas: vários XML entram de uma vez, sem lançar compras.
-- Cada chave aparece uma única vez; o XML original fica preservado para conferência.
-- A mesma caixa receberá resumos da SEFAZ em outra fase. Aqui não há consulta à SEFAZ.
-- Conferência e lançamento são lidos dos registros existentes, nunca duplicados aqui.
begin;

create table private.nfe_group_companies (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
  short_name text not null
);
alter table private.nfe_group_companies enable row level security;
revoke all on table private.nfe_group_companies from public, anon, authenticated, service_role;
insert into private.nfe_group_companies (cnpj, short_name) values
  ('55800425000177', 'RGF'), ('58286372000106', 'SF'),
  ('65332336000105', 'PAES & ART'), ('23111272000164', 'Pane e Salute antiga (final 64)');

create table public.payable_nfe_inbox (
  id uuid primary key default gen_random_uuid(),
  store text not null default 'jc' check (store = 'jc'),
  nfe_key text not null unique check (nfe_key ~ '^[0-9]{44}$'),
  recipient_cnpj text not null references private.nfe_group_companies(cnpj),
  emitter_cnpj text not null check (emitter_cnpj ~ '^[0-9]{14}$'),
  nfe_number text not null,
  nfe_series text not null,
  emitter_name text,
  issued_at timestamptz,
  total_value numeric(12,2) check (total_value >= 0),
  source text not null check (source in ('xml_manual', 'sefaz')),
  document_state text not null check (document_state in ('xml_completo', 'somente_resumo', 'ilegivel')),
  xml_content text check (length(xml_content) between 1 and 2000000),
  original_file_name text check (length(original_file_name) <= 255),
  received_by uuid references auth.users(id),
  received_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (document_state = 'ilegivel' or
    (nullif(trim(emitter_name), '') is not null and issued_at is not null and total_value is not null)),
  check (document_state <> 'xml_completo' or xml_content is not null),
  check (document_state <> 'somente_resumo' or xml_content is null),
  check (source <> 'xml_manual' or document_state = 'xml_completo'),
  check (substring(nfe_key from 7 for 14) = emitter_cnpj
    and substring(nfe_key from 23 for 3) = lpad(nfe_series, 3, '0')
    and substring(nfe_key from 26 for 9) = lpad(nfe_number, 9, '0'))
);
create index payable_nfe_inbox_received_at_idx on public.payable_nfe_inbox (received_at desc);
revoke all on table public.payable_nfe_inbox from public, anon, authenticated, service_role;
grant select on table public.payable_nfe_inbox to authenticated;
alter table public.payable_nfe_inbox enable row level security;
alter table public.payable_nfe_inbox force row level security;
create policy payable_nfe_inbox_select_importer on public.payable_nfe_inbox
for select to authenticated using (
  store = 'jc' and private.current_user_can_payables('contas_pagar.importar_xml')
);

create function private.payable_nfe_inbox_guarda() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'O XML original da nota fica guardado e não pode ser apagado nem trocado.';
  end if;
  if new.nfe_key is distinct from old.nfe_key
    or new.recipient_cnpj is distinct from old.recipient_cnpj
    or new.source is distinct from old.source
    or new.received_at is distinct from old.received_at
    or new.received_by is distinct from old.received_by
    or (old.xml_content is not null and new.xml_content is distinct from old.xml_content) then
    raise exception 'O XML original da nota fica guardado e não pode ser apagado nem trocado.';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger payable_nfe_inbox_guarda before update or delete on public.payable_nfe_inbox
for each row execute function private.payable_nfe_inbox_guarda();

create function private.nfe_inbox_ler_xml(p_xml text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  doc xml;
  nota record;
  chave text;
  motivo text;
  mensagem text;
  protocolo_chave text;
  protocolo_status text;
  emitente text;
  emissao timestamptz;
  valor numeric(12,2);
  soma integer := 0;
  resto integer;
  digito integer;
  i integer;
begin
  if nullif(trim(p_xml), '') is null then
    motivo := 'arquivo_vazio'; mensagem := 'O arquivo está vazio.';
  elsif length(p_xml) > 2000000 then
    motivo := 'grande_demais'; mensagem := 'O arquivo passa do limite de 2.000.000 de caracteres.';
  elsif p_xml ~* '<!(DOCTYPE|ENTITY)' then
    motivo := 'ilegivel'; mensagem := 'Este XML contém uma declaração não permitida.';
  else
    begin
      doc := xmlparse(document p_xml);
    exception when others then
      motivo := 'ilegivel'; mensagem := 'Não deu para ler este arquivo como XML.';
    end;
  end if;
  if motivo is not null then
    return jsonb_build_object('ok', false, 'motivo', motivo, 'mensagem', mensagem);
  end if;

  -- XMLTABLE usa XPath relativo à primeira infNFe, com ou sem prefixo de namespace.
  -- Colunas text também decodificam entidades XML nos nomes das empresas.
  select * into nota from xmltable('(//*[local-name()="infNFe"])[1]' passing doc columns
    id text path '@Id',
    modelo text path '*[local-name()="ide"]/*[local-name()="mod"]',
    ambiente text path '*[local-name()="ide"]/*[local-name()="tpAmb"]',
    uf text path '*[local-name()="ide"]/*[local-name()="cUF"]',
    cnpj text path '*[local-name()="emit"]/*[local-name()="CNPJ"]',
    cpf text path '*[local-name()="emit"]/*[local-name()="CPF"]',
    nome text path '*[local-name()="emit"]/*[local-name()="xNome"]',
    serie text path '*[local-name()="ide"]/*[local-name()="serie"]',
    numero text path '*[local-name()="ide"]/*[local-name()="nNF"]',
    tipo_emissao text path '*[local-name()="ide"]/*[local-name()="tpEmis"]',
    codigo text path '*[local-name()="ide"]/*[local-name()="cNF"]',
    dv text path '*[local-name()="ide"]/*[local-name()="cDV"]',
    destinatario text path '*[local-name()="dest"]/*[local-name()="CNPJ"]',
    nome_destinatario text path '*[local-name()="dest"]/*[local-name()="xNome"]',
    dh_emi text path '*[local-name()="ide"]/*[local-name()="dhEmi"]',
    d_emi text path '*[local-name()="ide"]/*[local-name()="dEmi"]',
    total text path '*[local-name()="total"]/*[local-name()="ICMSTot"]/*[local-name()="vNF"]'
  );
  if not found then
    if cardinality(xpath('//*[local-name()="infEvento"] | /*[local-name()="procEventoNFe" or local-name()="evento" or local-name()="envEvento" or local-name()="retEnvEvento"]', doc)) > 0 then
      motivo := 'evento'; mensagem := 'Este arquivo é um evento da nota (cancelamento, carta de correção ou ciência), não a nota.';
    else
      motivo := 'nao_e_nfe'; mensagem := 'Este arquivo não contém uma NF-e.';
    end if;
  else
    chave := case when left(nota.id, 3) = 'NFe' then substring(nota.id from 4) else nota.id end;
    if chave is null or chave !~ '^[0-9]{44}$' then
      motivo := 'chave_incoerente'; mensagem := 'A chave da nota precisa ter 44 dígitos.';
    elsif nota.modelo is distinct from '55' then
      motivo := 'modelo'; mensagem := 'Modelo ' || coalesce(nota.modelo, 'não informado') || ': só entram NF-e modelo 55; cupom 65 fica fora.';
    elsif nota.ambiente is distinct from '1' then
      motivo := 'homologacao'; mensagem := 'Nota de teste (homologação): não vale como compra.';
    else
      for i in 1..43 loop
        soma := soma + substring(chave from i for 1)::integer * (2 + ((43 - i) % 8));
      end loop;
      resto := soma % 11;
      digito := case when resto in (0, 1) then 0 else 11 - resto end;
      emitente := coalesce(nota.cnpj, '000' || nota.cpf);
      select x.chave, x.status into protocolo_chave, protocolo_status
      from xmltable('(//*[local-name()="protNFe"]/*[local-name()="infProt"])[1]' passing doc columns
        chave text path '*[local-name()="chNFe"]', status text path '*[local-name()="cStat"]') x;
      if emitente is null or emitente !~ '^[0-9]{14}$'
        or nota.uf is null or nota.uf !~ '^[0-9]{2}$'
        or nota.serie is null or nota.serie !~ '^[0-9]{1,3}$'
        or nota.numero is null or nota.numero !~ '^[0-9]{1,9}$'
        or nota.tipo_emissao is null or nota.tipo_emissao !~ '^[0-9]$'
        or nota.codigo is null or nota.codigo !~ '^[0-9]{1,8}$'
        or nota.dv is null or nota.dv !~ '^[0-9]$'
        or substring(chave from 1 for 2) <> nota.uf
        or substring(chave from 7 for 14) <> emitente
        or substring(chave from 21 for 2) <> nota.modelo
        or substring(chave from 23 for 3) <> lpad(nota.serie, 3, '0')
        or substring(chave from 26 for 9) <> lpad(nota.numero, 9, '0')
        or substring(chave from 35 for 1) <> nota.tipo_emissao
        or substring(chave from 36 for 8) <> lpad(nota.codigo, 8, '0')
        or right(chave, 1) <> nota.dv or right(chave, 1)::integer <> digito
        or (protocolo_chave is not null and protocolo_chave <> chave) then
        motivo := 'chave_incoerente'; mensagem := 'A chave da nota não confere com os dados do XML.';
      elsif protocolo_status is not null and protocolo_status not in ('100', '150') then
        motivo := 'nao_autorizada'; mensagem := 'A nota não está autorizada: código ' || protocolo_status || '.';
      elsif nullif(trim(nota.destinatario), '') is null then
        motivo := 'sem_destinatario'; mensagem := 'A nota não informa o CNPJ do destinatário.';
      elsif not exists (select 1 from private.nfe_group_companies c where c.cnpj = nota.destinatario) then
        motivo := 'destinatario_fora';
        mensagem := 'Destinatário ' || case when nota.destinatario ~ '^[0-9]{14}$' then
          substring(nota.destinatario from 1 for 2) || '.' || substring(nota.destinatario from 3 for 3) || '.' ||
          substring(nota.destinatario from 6 for 3) || '/' || substring(nota.destinatario from 9 for 4) || '-' || right(nota.destinatario, 2)
          else left(nota.destinatario, 20) end || ' (' || left(coalesce(nota.nome_destinatario, 'sem nome'), 80) ||
          '). Só entram notas da RGF, da SF, da PAES & ART e da antiga final 64.';
      else
        begin
          if nota.dh_emi is not null then
            if nota.dh_emi !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'data'; end if;
            emissao := nota.dh_emi::timestamptz;
          else
            if nota.d_emi is null or nota.d_emi !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'data'; end if;
            emissao := nota.d_emi::date::timestamp at time zone 'America/Sao_Paulo';
          end if;
        exception when others then
          motivo := 'ilegivel'; mensagem := 'A data de emissão da nota não pôde ser lida.';
        end;
        if motivo is null and nullif(trim(nota.nome), '') is null then
          motivo := 'ilegivel'; mensagem := 'O nome do emitente da nota não pôde ser lido.';
        end if;
        if motivo is null then
          begin
            if nota.total is null or nota.total !~ '^[0-9]+([.][0-9]{1,2})?$' then raise exception 'valor'; end if;
            valor := nota.total::numeric;
          exception when others then
            motivo := 'ilegivel'; mensagem := 'O valor total da nota não pôde ser lido.';
          end;
        end if;
        if motivo is null then
          return jsonb_build_object('ok', true, 'chave', chave, 'recipient_cnpj', nota.destinatario,
            'emitter_cnpj', emitente, 'emitter_name', trim(nota.nome),
            'numero', coalesce(nullif(ltrim(nota.numero, '0'), ''), '0'),
            'serie', coalesce(nullif(ltrim(nota.serie, '0'), ''), '0'), 'issued_at', emissao, 'total_value', valor);
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', false, 'motivo', motivo, 'mensagem', mensagem, 'chave', chave);
exception when others then
  -- XML bem formado ainda pode ter campos repetidos ou conversões impossíveis.
  -- Nunca exponha SQLERRM nem deixe conteúdo ruim interromper o lote.
  return jsonb_build_object('ok', false, 'motivo', 'ilegivel', 'mensagem', 'Não deu para ler os campos desta nota.', 'chave', chave);
end;
$$;

create function public.receive_nfe_inbox_xml(p_xml_content text, p_file_name text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  nota jsonb;
  registro public.payable_nfe_inbox%rowtype;
  resultado text;
  mensagem text;
begin
  if not private.current_user_can_payables('contas_pagar.importar_xml') then
    raise exception using errcode = '42501', message = 'Sem permissão para receber notas.';
  end if;
  nota := private.nfe_inbox_ler_xml(p_xml_content);
  if not (nota->>'ok')::boolean then
    return jsonb_build_object('resultado', 'recusada', 'motivo', nota->>'motivo', 'mensagem', nota->>'mensagem',
      'id', null, 'chave', nota->>'chave', 'numero', null, 'emitente', null, 'ja_no_erp', false);
  end if;
  insert into public.payable_nfe_inbox (nfe_key, recipient_cnpj, emitter_cnpj, nfe_number, nfe_series,
    emitter_name, issued_at, total_value, source, document_state, xml_content, original_file_name, received_by)
  values (nota->>'chave', nota->>'recipient_cnpj', nota->>'emitter_cnpj', nota->>'numero', nota->>'serie',
    nota->>'emitter_name', (nota->>'issued_at')::timestamptz, (nota->>'total_value')::numeric,
    'xml_manual', 'xml_completo', p_xml_content, left(p_file_name, 255), auth.uid())
  on conflict (nfe_key) do nothing returning * into registro;
  if found then
    resultado := 'entrou'; mensagem := 'Nota recebida para conferência.';
  else
    -- A trava também serializa dois XML que tentam completar o mesmo resumo.
    select * into registro from public.payable_nfe_inbox where nfe_key = nota->>'chave' for update;
    if registro.xml_content is null then
      update public.payable_nfe_inbox set xml_content = p_xml_content, document_state = 'xml_completo',
        emitter_cnpj = nota->>'emitter_cnpj', nfe_number = nota->>'numero', nfe_series = nota->>'serie',
        emitter_name = nota->>'emitter_name', issued_at = (nota->>'issued_at')::timestamptz,
        total_value = (nota->>'total_value')::numeric, original_file_name = left(p_file_name, 255)
      where id = registro.id;
      resultado := 'completou'; mensagem := 'XML anexado à nota que já estava na caixa.';
    else
      resultado := 'ja_existia'; mensagem := 'Esta nota já estava na caixa. O XML original foi preservado.';
    end if;
  end if;
  return jsonb_build_object('resultado', resultado, 'motivo', null, 'mensagem', mensagem,
    'id', registro.id, 'chave', nota->>'chave', 'numero', nota->>'numero', 'emitente', nota->>'emitter_name',
    'ja_no_erp', exists (select 1 from public.payable_purchases p where p.nfe_key = nota->>'chave'));
end;
$$;

create function public.list_nfe_inbox(p_limit integer default 300) returns table (
  inbox_id uuid, inbox_nfe_key text, inbox_recipient_cnpj text, inbox_recipient_label text,
  inbox_emitter_cnpj text, inbox_emitter_name text, inbox_number text, inbox_series text,
  inbox_issued_at timestamptz, inbox_total_value numeric, inbox_source text, inbox_document_state text,
  inbox_has_xml boolean, inbox_original_file_name text, inbox_received_at timestamptz,
  inbox_status text, inbox_draft_id uuid, inbox_purchase_id uuid, inbox_purchase_status text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.current_user_can_payables('contas_pagar.importar_xml') then
    raise exception using errcode = '42501', message = 'Sem permissão para receber notas.';
  end if;
  return query
  select i.id, i.nfe_key, i.recipient_cnpj, c.short_name, i.emitter_cnpj, i.emitter_name,
    i.nfe_number, i.nfe_series, i.issued_at, i.total_value, i.source, i.document_state,
    i.xml_content is not null, i.original_file_name, i.received_at, estado.status,
    d.id, p.id, p.status
  from public.payable_nfe_inbox i
  join private.nfe_group_companies c on c.cnpj = i.recipient_cnpj
  left join public.payable_purchases p on p.nfe_key = i.nfe_key
  left join public.payable_import_drafts d on d.nfe_key = i.nfe_key and d.status = 'pendente'
  cross join lateral (select case
    when p.id is not null then case when p.created_at < i.received_at then 'ja_no_erp' else 'lancada' end
    when i.document_state = 'ilegivel' then 'ilegivel'
    when d.id is not null then 'conferencia_comecada'
    when i.document_state = 'somente_resumo' then 'aguardando_xml'
    else 'esperando_conferencia' end as status) estado
  where i.store = 'jc'
  order by (estado.status in ('esperando_conferencia', 'conferencia_comecada', 'aguardando_xml', 'ilegivel')) desc,
    i.issued_at desc nulls last, i.received_at desc
  limit greatest(1, least(coalesce(p_limit, 300), 1000));
end;
$$;

-- Defaults de privilégios variam entre ambientes: fixe e confira os acessos efetivos.
alter table private.nfe_group_companies owner to postgres;
alter table public.payable_nfe_inbox owner to postgres;
do $block$
declare f record; papel text;
begin
  for f in select p.oid::regprocedure as assinatura, n.nspname
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'private' and p.proname in ('payable_nfe_inbox_guarda', 'nfe_inbox_ler_xml'))
       or (n.nspname = 'public' and p.proname in ('receive_nfe_inbox_xml', 'list_nfe_inbox'))
  loop
    execute format('alter function %s owner to postgres', f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.assinatura);
    if f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated', f.assinatura);
    else
      foreach papel in array array['anon', 'authenticated', 'service_role'] loop
        if pg_catalog.has_function_privilege(papel, f.assinatura, 'execute') then
          raise exception 'Acesso indevido à função privada % para %.', f.assinatura, papel;
        end if;
      end loop;
      if exists (select 1 from pg_catalog.pg_proc p, lateral pg_catalog.aclexplode(p.proacl) a
        where p.oid = f.assinatura::oid and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
        raise exception 'Acesso público indevido à função privada %.', f.assinatura;
      end if;
    end if;
  end loop;
end;
$block$;
commit;
