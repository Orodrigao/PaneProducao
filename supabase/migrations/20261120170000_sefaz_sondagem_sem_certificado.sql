-- Comparar somente hom1, sem cofre, certificado, chave ou corpo na resposta.
create function private.sefaz_sondagem_sem_certificado()
returns jsonb language plpgsql volatile security definer set search_path = ''
set client_min_messages = 'warning'
as $$
declare response sefaz_http.http_response; started timestamptz := clock_timestamp();
begin
  perform sefaz_http.http_reset_curlopt();
  if not sefaz_http.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','1000')
      or not sefaz_http.http_set_curlopt('CURLOPT_TIMEOUT_MS','2000')
      or not sefaz_http.http_set_curlopt('CURLOPT_SSL_VERIFYPEER','1')
      or not sefaz_http.http_set_curlopt('CURLOPT_SSL_VERIFYHOST','2') then
    raise exception 'Opcoes TLS indisponiveis.';
  end if;
  select * into response from private.sefaz_http_call(('POST',
    private.sefaz_endpoint('evento_homologacao'),
    array[sefaz_http.http_header('Accept','application/soap+xml')],
    'application/soap+xml; charset=utf-8','<x/>')::sefaz_http.http_request);
  perform sefaz_http.http_reset_curlopt();
  return jsonb_build_object('status','ok','http',response.status,
    'ms_banco',floor(extract(epoch from (clock_timestamp()-started))*1000));
exception
  when query_canceled then
    perform sefaz_http.http_reset_curlopt();
    return jsonb_build_object('status','falhou','motivo','tempo_banco',
      'ms_banco',floor(extract(epoch from (clock_timestamp()-started))*1000));
  when others then
    perform sefaz_http.http_reset_curlopt();
    return jsonb_build_object('status','falhou','motivo','falha_transporte',
      'erro',private.sefaz_tipo_de_falha(sqlerrm),'codigo',sqlstate,
      'erro_texto',private.sefaz_texto_de_falha(sqlerrm),
      'ms_banco',floor(extract(epoch from (clock_timestamp()-started))*1000));
end;
$$;

alter function private.sefaz_sondagem_sem_certificado() owner to postgres;
revoke all on function private.sefaz_sondagem_sem_certificado() from public, anon, authenticated, service_role;

create or replace function public.sefaz_prova_evento(p_empresa text)
returns jsonb language sql volatile security definer set search_path = ''
as $$
  select private.sefaz_transport(p_empresa,'evento_homologacao',null,null)
    || jsonb_build_object('sondagem_sem_certificado',private.sefaz_sondagem_sem_certificado());
$$;

-- Preservar dono e ACL da RPC; qualquer desvio aborta a migration.
do $block$
declare assinatura regprocedure; papel text;
begin
  foreach assinatura in array array[
    'private.sefaz_sondagem_sem_certificado()'::regprocedure,
    'public.sefaz_prova_evento(text)'::regprocedure
  ] loop
    if not exists (select 1 from pg_catalog.pg_proc
      where oid=assinatura and proowner='postgres'::regrole) then
      raise exception 'Dono indevido na funcao %.', assinatura;
    end if;
    if exists (select 1 from pg_catalog.pg_proc p,
      lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      where p.oid=assinatura and a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'Execucao publica indevida da funcao %.', assinatura;
    end if;
    foreach papel in array array['anon','authenticated','service_role'] loop
      if pg_catalog.has_function_privilege(papel,assinatura,'execute')
          <> (assinatura='public.sefaz_prova_evento(text)'::regprocedure and papel='service_role') then
        raise exception 'Privilegio indevido da funcao % para %.', assinatura, papel;
      end if;
    end loop;
  end loop;
end;
$block$;
