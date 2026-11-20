-- Classificacao fechada: nenhum trecho da mensagem pode sair do banco.
create function private.sefaz_tipo_de_falha(p_mensagem text)
returns text language sql immutable security definer set search_path = ''
as $$
  select case
    when strpos(mensagem,'could not resolve') > 0
      or strpos(mensagem,'couldn''t resolve') > 0
      or strpos(mensagem,'resolve host') > 0 then 'dns'
    when strpos(mensagem,'timed out') > 0
      or strpos(mensagem,'timeout') > 0 then 'tempo_esgotado'
    when strpos(mensagem,'failed to connect') > 0
      or strpos(mensagem,'couldn''t connect') > 0
      or strpos(mensagem,'connection refused') > 0
      or strpos(mensagem,'network is unreachable') > 0
      or strpos(mensagem,'no route to host') > 0 then 'conexao_recusada'
    when strpos(mensagem,'client certificate') > 0
      or strpos(mensagem,'local ssl certificate') > 0
      or strpos(mensagem,'private key') > 0
      or strpos(mensagem,'unable to use client') > 0
      or strpos(mensagem,'unable to set') > 0
      or strpos(mensagem,'pem blob') > 0
      or strpos(mensagem,'could not load pem') > 0
      or strpos(mensagem,'key values mismatch') > 0 then 'certificado_local'
    when strpos(mensagem,'ssl certificate problem') > 0
      or strpos(mensagem,'peer certificate') > 0
      or strpos(mensagem,'unable to get local issuer') > 0
      or strpos(mensagem,'certificate verify failed') > 0
      or strpos(mensagem,'self-signed') > 0
      or strpos(mensagem,'self signed') > 0
      or strpos(mensagem,'certificate has expired') > 0 then 'certificado_servidor'
    when strpos(mensagem,'renegotiat') > 0 then 'renegociacao'
    when strpos(mensagem,'recv failure') > 0
      or strpos(mensagem,'failure when receiving') > 0
      or strpos(mensagem,'send failure') > 0
      or strpos(mensagem,'failure when sending') > 0
      or strpos(mensagem,'connection reset') > 0
      or strpos(mensagem,'empty reply') > 0
      or strpos(mensagem,'unexpected eof') > 0
      or strpos(mensagem,'connection died') > 0 then 'conexao_encerrada'
    when strpos(mensagem,'ssl connect error') > 0
      or strpos(mensagem,'ssl_connect') > 0
      or strpos(mensagem,'handshake') > 0
      or strpos(mensagem,'alert') > 0
      or strpos(mensagem,'wrong version number') > 0
      or strpos(mensagem,'unsupported protocol') > 0
      or strpos(mensagem,'no protocols available') > 0
      or strpos(mensagem,'cipher') > 0 then 'handshake_tls'
    when strpos(mensagem,'curl option') > 0
      or strpos(mensagem,'invalid curlopt') > 0
      or strpos(mensagem,'unknown option') > 0
      or strpos(mensagem,'not available for run-time') > 0 then 'opcao_curl'
    when strpos(mensagem,'request cancelled') > 0 then 'cancelado'
    when strpos(mensagem,'permission denied') > 0 then 'permissao'
    else 'outro'
  end
  from (select lower(coalesce(p_mensagem,'')) as mensagem) normalizada;
$$;

alter function private.sefaz_tipo_de_falha(text) owner to postgres;
revoke all on function private.sefaz_tipo_de_falha(text) from public, anon, authenticated, service_role;

create or replace function private.sefaz_transport(p_empresa text, p_id text, p_modo text, p_numero text)
returns jsonb language plpgsql volatile security definer set search_path = ''
set client_min_messages = 'warning'
as $$
declare credentials text[]; meta jsonb; k numeric[]; endpoint text; body text; action_name text;
  response sefaz_http.http_response; started timestamptz := clock_timestamp(); fictitious text;
  status_text text; etapa text := 'entrada_invalida';
begin
  perform sefaz_http.http_reset_curlopt();
  perform private.sefaz_validate(p_empresa,p_id,p_modo,p_numero);
  if private.sefaz_registro_seguro() is not true then
    return jsonb_build_object('status','falhou','motivo','registro_inseguro',
      'ms_banco',floor(extract(epoch from (clock_timestamp()-started))*1000));
  end if;
  endpoint := private.sefaz_endpoint(p_id);
  etapa := 'falha_cofre'; credentials := private.sefaz_credentials(p_empresa);
  etapa := 'certificado_invalido'; meta := private.sefaz_certificate(credentials[1]);
  etapa := 'chave_invalida'; k := private.sefaz_rsa_key(credentials[2]);
  etapa := 'certificado_invalido';
  if k[1] <> (meta->>'n')::numeric or k[2] <> (meta->>'e')::numeric
      or clock_timestamp() < (meta->>'not_before')::timestamptz
      or clock_timestamp() >= (meta->>'not_after')::timestamptz then
    raise exception 'Certificado invalido.';
  end if;
  if p_id = 'dfe_producao' then
    body := private.sefaz_dfe_xml(meta->>'cnpj',p_modo,p_numero);
    action_name := 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';
  elsif p_id = 'evento_homologacao' then
    etapa := 'assinatura_falhou';
    -- Chave fixa, ficticia, cUF 43/modelo 55/DV valido; nenhum dado de nota real.
    fictitious := '43261111222333000181550010000000011000000016';
    body := '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>'
      ||'<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">'
      ||'<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote>'
      ||private.sefaz_evento_xml(credentials[1],credentials[2],fictitious,clock_timestamp())
      ||'</envEvento></nfeDadosMsg></soap12:Body></soap12:Envelope>';
    action_name := 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento';
  else endpoint := endpoint||p_numero; end if;
  etapa := 'tls_indisponivel'; perform private.sefaz_http_options(credentials[1],credentials[2]);
  etapa := 'falha_transporte';
  if p_id = 'adn_producao' then
    select * into response from private.sefaz_http_call(('GET',endpoint,
      array[sefaz_http.http_header('Accept','application/json')],null,null)::sefaz_http.http_request);
  else
    select * into response from private.sefaz_http_call(('POST',endpoint,
      array[sefaz_http.http_header('Accept','application/soap+xml')],
      'application/soap+xml; charset=utf-8; action="'||action_name||'"',body)::sefaz_http.http_request);
  end if;
  perform sefaz_http.http_reset_curlopt();
  -- A extensao pode seguir o salto e acumular Location nos cabecalhos.
  if response.status between 300 and 399 or exists (
    select 1 from unnest(response.headers) as h where lower(h.field) = 'location'
  ) then
    return jsonb_build_object('status','falhou','motivo','redirecionado',
      'ms_banco',floor(extract(epoch from (clock_timestamp()-started))*1000));
  end if;
  return jsonb_build_object('status','ok','http',response.status,'body',response.content,
    'dias_para_vencer',floor(extract(epoch from ((meta->>'not_after')::timestamptz-clock_timestamp()))/86400),
    'ms_banco',floor(extract(epoch from (clock_timestamp()-started))*1000));
exception
  when query_canceled then
    perform sefaz_http.http_reset_curlopt();
    return jsonb_build_object('status','falhou','motivo','tempo_banco',
      'ms_banco',floor(extract(epoch from (clock_timestamp()-started))*1000));
  when others then
    status_text := case when sqlstate = 'P0404' then 'sem_certificado' else 'falhou' end;
    perform sefaz_http.http_reset_curlopt();
    -- Somente o tipo fixo e o codigo saem; a mensagem fica nesta chamada.
    return jsonb_build_object('status',status_text,'motivo',case when sqlstate = 'P0404'
      then 'certificado nao guardado' when sqlstate = 'P0422' then 'chave_cifrada' else etapa end,
      'ms_banco',floor(extract(epoch from (clock_timestamp()-started))*1000))
      || case when etapa = 'falha_transporte' then jsonb_build_object(
        'erro',private.sefaz_tipo_de_falha(sqlerrm),'codigo',sqlstate) else '{}'::jsonb end;
end;
$$;

-- CREATE OR REPLACE preserva dono e ACL do transporte; conferir sem ampliar acesso.
do $block$
declare assinatura regprocedure; papel text;
begin
  foreach assinatura in array array[
    'private.sefaz_tipo_de_falha(text)'::regprocedure,
    'private.sefaz_transport(text,text,text,text)'::regprocedure
  ] loop
    if not exists (select 1 from pg_catalog.pg_proc
      where oid=assinatura and proowner='postgres'::regrole) then
      raise exception 'Dono indevido na funcao %.', assinatura;
    end if;
    foreach papel in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_function_privilege(papel,assinatura,'execute') then
        raise exception 'Execucao indevida da funcao % para %.', assinatura, papel;
      end if;
    end loop;
  end loop;
end;
$block$;
