-- Fase 0: transporte fechado, sem persistencia e sem chave fora do Vault/banco.
begin;

create schema if not exists sefaz_http authorization postgres;
revoke all on schema sefaz_http from public, anon, authenticated, service_role;
create extension if not exists http with schema sefaz_http;

-- O schema bloqueia o acesso mesmo quando o dono da extensao concedeu EXECUTE
-- a PUBLIC e postgres nao pode revogar essa concessao de supabase_admin.
-- Manter tambem a revogacao por funcao, sem tocar nas outras extensoes.
do $block$
declare f record;
begin
  if (select extnamespace from pg_catalog.pg_extension where extname = 'http')
      <> 'sefaz_http'::regnamespace then
    raise exception 'A extensao http deve estar no schema sefaz_http.';
  end if;
  for f in
    select p.oid::regprocedure as assinatura
    from pg_catalog.pg_proc p
    join pg_catalog.pg_depend d on d.classid = 'pg_catalog.pg_proc'::regclass
      and d.objid = p.oid and d.deptype = 'e'
    join pg_catalog.pg_extension e on e.oid = d.refobjid
      and d.refclassid = 'pg_catalog.pg_extension'::regclass
    where e.extname = 'http'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.assinatura);
  end loop;
end;
$block$;

-- ASN.1 DER, indices externos comecam em 1; sem comprimentos indefinidos.
create function private.sefaz_der_node(p_der bytea, p_at integer)
returns integer[] language plpgsql immutable security definer set search_path = ''
as $$
declare b integer; n integer; len integer; pos integer; i integer;
begin
  if p_der is null or p_at is null or p_at < 1 or p_at + 1 > octet_length(p_der)
      or octet_length(p_der) > 65536 then
    raise exception 'DER invalido.';
  end if;
  b := get_byte(p_der, p_at); pos := p_at + 2;
  if b < 128 then len := b;
  else
    n := b - 128; len := 0;
    if n < 1 or n > 3 or p_at + 1 + n > octet_length(p_der) then
      raise exception 'DER invalido.';
    end if;
    for i in 1..n loop
      len := len * 256 + get_byte(p_der, pos - 1); pos := pos + 1;
    end loop;
    if len < 128 then raise exception 'DER invalido.'; end if;
  end if;
  if pos + len - 1 > octet_length(p_der) then raise exception 'DER invalido.'; end if;
  return array[get_byte(p_der, p_at - 1), pos, len, pos + len];
end;
$$;

create function private.sefaz_der_content(p_der bytea, p_tag integer)
returns bytea language plpgsql immutable security definer set search_path = ''
as $$
declare n integer[];
begin
  n := private.sefaz_der_node(p_der, 1);
  if n[1] <> p_tag or n[4] <> octet_length(p_der) + 1 then raise exception 'DER invalido.'; end if;
  return substring(p_der from n[2] for n[3]);
end;
$$;

create function private.sefaz_der_fields(p_der bytea)
returns bytea[] language plpgsql immutable security definer set search_path = ''
as $$
declare content bytea; pos integer := 1; n integer[]; fields bytea[] := '{}';
begin
  content := private.sefaz_der_content(p_der, 48);
  while pos <= octet_length(content) loop
    n := private.sefaz_der_node(content, pos);
    fields := array_append(fields, substring(content from pos for n[4] - pos));
    pos := n[4];
    if cardinality(fields) > 64 then raise exception 'DER invalido.'; end if;
  end loop;
  return fields;
end;
$$;

create function private.sefaz_bytes_integer(p_bytes bytea)
returns numeric language plpgsql immutable security definer set search_path = ''
as $$
declare v numeric := 0; i integer;
begin
  if p_bytes is null or octet_length(p_bytes) > 1025 then raise exception 'Inteiro RSA invalido.'; end if;
  for i in 0..octet_length(p_bytes)-1 loop v := v * 256 + get_byte(p_bytes, i); end loop;
  return v;
end;
$$;

create function private.sefaz_integer_bytes(p_value numeric, p_size integer)
returns bytea language plpgsql immutable security definer set search_path = ''
as $$
declare v numeric := p_value; result bytea; i integer;
begin
  if v is null or v < 0 or v <> trunc(v) or p_size not between 1 and 1024 then
    raise exception 'Inteiro RSA invalido.';
  end if;
  result := decode(repeat('00', p_size), 'hex');
  for i in reverse p_size-1..0 loop
    result := set_byte(result, i, mod(v, 256)::integer); v := div(v, 256);
  end loop;
  if v <> 0 then raise exception 'Inteiro RSA invalido.'; end if;
  return result;
end;
$$;

create function private.sefaz_pem_der(p_pem text, p_kind text)
returns bytea language plpgsql immutable security definer set search_path = ''
as $$
declare label text; part text[]; normalized text;
begin
  if p_pem is null or length(p_pem) > 32768 or p_kind not in ('certificado', 'chave') then
    raise exception 'PEM invalido.';
  end if;
  normalized := replace(p_pem, E'\r', '');
  if p_kind = 'chave' and (position('ENCRYPTED' in normalized) > 0
      or position('Proc-Type: 4,ENCRYPTED' in normalized) > 0) then
    raise exception using errcode = 'P0422', message = 'Chave cifrada: refaca a conversao sem senha.';
  end if;
  if p_kind = 'certificado' then label := 'CERTIFICATE';
  elsif position('-----BEGIN RSA PRIVATE KEY-----' in normalized) > 0 then label := 'RSA PRIVATE KEY';
  else label := 'PRIVATE KEY'; end if;
  part := regexp_match(normalized, '-----BEGIN ' || label || '-----([A-Za-z0-9+/=[:space:]]+)-----END ' || label || '-----');
  if part is null then raise exception 'PEM invalido.'; end if;
  return decode(regexp_replace(part[1], '[[:space:]]', '', 'g'), 'base64');
end;
$$;

create function private.sefaz_rsa_key(p_pem text)
returns numeric[] language plpgsql immutable security definer set search_path = ''
as $$
declare der bytea; f bytea[]; alg bytea[]; nums numeric[] := '{}'; i integer;
begin
  der := private.sefaz_pem_der(p_pem, 'chave'); f := private.sefaz_der_fields(der);
  if cardinality(f) = 3 then
    alg := private.sefaz_der_fields(f[2]);
    if encode(alg[1], 'hex') <> '06092a864886f70d010101' then raise exception 'Chave deve ser RSA.'; end if;
    der := private.sefaz_der_content(f[3], 4); f := private.sefaz_der_fields(der);
  end if;
  if cardinality(f) <> 9 or private.sefaz_der_content(f[1], 2) <> decode('00', 'hex') then
    raise exception 'Chave RSA invalida.';
  end if;
  for i in 2..9 loop
    nums := array_append(nums, private.sefaz_bytes_integer(private.sefaz_der_content(f[i], 2)));
  end loop;
  -- n,e,d,p,q,dp,dq,qinv. Limitar o custo e rejeitar chave inconsistente.
  if nums[1] < power(2::numeric, 2047) or nums[1] >= power(2::numeric, 4096)
      or nums[2] <> 65537 or nums[4] < 3 or nums[5] < 3
      or nums[4] * nums[5] <> nums[1] or mod(nums[8]*nums[5], nums[4]) <> 1
      or nums[6] <> mod(nums[3], nums[4]-1) or nums[7] <> mod(nums[3], nums[5]-1)
      or mod(nums[2]*nums[3], nums[4]-1) <> 1 or mod(nums[2]*nums[3], nums[5]-1) <> 1 then
    raise exception 'Chave RSA invalida (2048 a 4096 bits).';
  end if;
  return nums;
end;
$$;

create function private.sefaz_cnpj_valido(p_cnpj text)
returns boolean language plpgsql immutable security definer set search_path = ''
as $$
declare s integer; d integer; i integer; j integer; weight integer;
begin
  if p_cnpj is null or p_cnpj !~ '^[0-9]{14}$' or p_cnpj ~ '^([0-9])\1{13}$' then return false; end if;
  for j in 13..14 loop
    s := 0;
    for i in 1..j-1 loop
      weight := mod(j - i - 1, 8) + 2;
      s := s + substring(p_cnpj from i for 1)::integer * weight;
    end loop;
    d := case when mod(s, 11) < 2 then 0 else 11 - mod(s, 11) end;
    if d <> substring(p_cnpj from j for 1)::integer then return false; end if;
  end loop;
  return true;
end;
$$;

create function private.sefaz_der_time(p_der bytea)
returns timestamptz language plpgsql immutable security definer set search_path = ''
as $$
declare n integer[]; t text; year_text text;
begin
  n := private.sefaz_der_node(p_der, 1);
  t := convert_from(private.sefaz_der_content(p_der, n[1]), 'UTF8');
  if n[1] = 23 and t ~ '^[0-9]{12}Z$' then
    year_text := case when substring(t,1,2)::integer >= 50 then '19' else '20' end;
    t := year_text || t;
  elsif n[1] <> 24 or t !~ '^[0-9]{14}Z$' then raise exception 'Validade do certificado invalida.'; end if;
  return (substring(t,1,4)||'-'||substring(t,5,2)||'-'||substring(t,7,2)||'T'||
    substring(t,9,2)||':'||substring(t,11,2)||':'||substring(t,13,2)||'+00:00')::timestamptz;
end;
$$;

create function private.sefaz_certificate(p_pem text)
returns jsonb language plpgsql immutable security definer set search_path = ''
as $$
declare cert bytea[]; tbs bytea[]; validity bytea[]; subject bytea; n integer[];
  pos integer := 1; rdn bytea; rp integer; rn integer[]; attr bytea[];
  cn text; cnpj text; shift integer := 0; spki bytea[]; pub bytea[]; bits bytea;
begin
  cert := private.sefaz_der_fields(private.sefaz_pem_der(p_pem, 'certificado'));
  tbs := private.sefaz_der_fields(cert[1]);
  if get_byte(tbs[1], 0) = 160 then shift := 1; end if;
  validity := private.sefaz_der_fields(tbs[4+shift]);
  subject := private.sefaz_der_content(tbs[5+shift], 48);
  while pos <= octet_length(subject) loop
    n := private.sefaz_der_node(subject, pos);
    rdn := private.sefaz_der_content(substring(subject from pos for n[4]-pos), 49); rp := 1;
    while rp <= octet_length(rdn) loop
      rn := private.sefaz_der_node(rdn, rp);
      attr := private.sefaz_der_fields(substring(rdn from rp for rn[4]-rp));
      if encode(attr[1], 'hex') = '0603550403' then
        if cn is not null then raise exception 'CN ambiguo.'; end if;
        rn := private.sefaz_der_node(attr[2], 1);
        if rn[1] not in (12,19) then raise exception 'CN invalido.'; end if;
        cn := convert_from(private.sefaz_der_content(attr[2], rn[1]), 'UTF8');
      end if;
      rn := private.sefaz_der_node(rdn, rp); rp := rn[4];
    end loop;
    pos := n[4];
  end loop;
  cnpj := substring(cn from ':([0-9]{14})$');
  if not private.sefaz_cnpj_valido(cnpj) then raise exception 'Certificado sem CNPJ valido no CN.'; end if;
  spki := private.sefaz_der_fields(tbs[6+shift]);
  attr := private.sefaz_der_fields(spki[1]);
  if encode(attr[1], 'hex') <> '06092a864886f70d010101' then raise exception 'Certificado deve ser RSA.'; end if;
  bits := private.sefaz_der_content(spki[2], 3);
  if get_byte(bits, 0) <> 0 then raise exception 'Certificado RSA invalido.'; end if;
  pub := private.sefaz_der_fields(substring(bits from 2));
  return jsonb_build_object('cnpj', cnpj,
    'not_before', private.sefaz_der_time(validity[1]), 'not_after', private.sefaz_der_time(validity[2]),
    'n', private.sefaz_bytes_integer(private.sefaz_der_content(pub[1], 2)),
    'e', private.sefaz_bytes_integer(private.sefaz_der_content(pub[2], 2)));
end;
$$;

create function private.sefaz_modpow(p_base numeric, p_exp numeric, p_mod numeric)
returns numeric language plpgsql immutable security definer set search_path = ''
as $$
declare b numeric := mod(p_base, p_mod); e numeric := p_exp; r numeric := 1;
begin
  if e < 0 or e <> trunc(e) or p_mod < 2 then raise exception 'RSA invalido.'; end if;
  while e > 0 loop
    if mod(e, 2) = 1 then r := mod(r * b, p_mod); end if;
    e := div(e, 2); b := mod(b * b, p_mod);
  end loop;
  return r;
end;
$$;

-- XML canonico por construcao: so campos validados, namespaces explicitos,
-- nenhuma tag vazia, ordem fixa. Nao existe assinatura publica generica.
create function private.sefaz_evento_info(p_cnpj text, p_chave text, p_at timestamptz)
returns text language plpgsql immutable security definer set search_path = ''
as $$
declare s integer := 0; i integer; dv integer;
begin
  if not private.sefaz_cnpj_valido(p_cnpj) or p_chave is null or p_chave !~ '^[0-9]{44}$'
      or substring(p_chave,1,2) <> '43' or substring(p_chave,21,2) <> '55' or p_at is null then
    raise exception 'Entrada de evento invalida.';
  end if;
  for i in 1..43 loop s := s + substring(p_chave,i,1)::integer * (mod(43-i,8)+2); end loop;
  dv := case when mod(s,11) in (0,1) then 0 else 11-mod(s,11) end;
  if dv <> right(p_chave,1)::integer then raise exception 'Chave ficticia invalida.'; end if;
  return '<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" Id="ID210210'||p_chave||'01">'
    ||'<cOrgao>91</cOrgao><tpAmb>2</tpAmb><CNPJ>'||p_cnpj||'</CNPJ><chNFe>'||p_chave||'</chNFe>'
    ||'<dhEvento>'||to_char(p_at at time zone 'America/Sao_Paulo','YYYY-MM-DD"T"HH24:MI:SS')||'-03:00</dhEvento>'
    ||'<tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>'
    ||'<detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento>';
end;
$$;

create function private.sefaz_signed_info(p_info text, p_id text)
returns text language sql immutable security definer set search_path = ''
as $$
  select '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">'
    ||'<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod>'
    ||'<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>'
    ||'<Reference URI="#'||p_id||'"><Transforms>'
    ||'<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>'
    ||'<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform></Transforms>'
    ||'<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>'
    ||replace(encode(extensions.digest(convert_to(p_info,'UTF8'),'sha1'),'base64'),E'\n','')
    ||'</DigestValue></Reference></SignedInfo>';
$$;

create function private.sefaz_evento_xml(p_cert text, p_key text, p_chave text, p_at timestamptz)
returns text language plpgsql immutable security definer set search_path = ''
as $$
declare meta jsonb; k numeric[]; info text; si text; em bytea; size_bytes integer := 0;
  tmp numeric; m numeric; m1 numeric; m2 numeric; sig numeric; signature_text text; cert_text text;
begin
  meta := private.sefaz_certificate(p_cert); k := private.sefaz_rsa_key(p_key);
  if k[1] <> (meta->>'n')::numeric or k[2] <> (meta->>'e')::numeric then
    raise exception 'Certificado e chave nao correspondem.';
  end if;
  info := private.sefaz_evento_info(meta->>'cnpj', p_chave, p_at);
  si := private.sefaz_signed_info(info, 'ID210210'||p_chave||'01');
  tmp := k[1];
  while tmp > 0 loop size_bytes := size_bytes + 1; tmp := div(tmp, 256); end loop;
  em := decode('0001'||repeat('ff', size_bytes-38)||'003021300906052b0e03021a05000414','hex')
    ||extensions.digest(convert_to(si,'UTF8'),'sha1');
  m := private.sefaz_bytes_integer(em);
  m1 := private.sefaz_modpow(m, k[6], k[4]); m2 := private.sefaz_modpow(m, k[7], k[5]);
  sig := m2 + k[5] * mod(mod(k[8] * (m1-m2), k[4]) + k[4], k[4]);
  -- Conferir CRT com a chave publica antes de usar o resultado.
  if private.sefaz_modpow(sig,k[2],k[1]) <> m then raise exception 'Falha na assinatura RSA.'; end if;
  signature_text := replace(encode(private.sefaz_integer_bytes(sig,size_bytes),'base64'),E'\n','');
  cert_text := replace(encode(private.sefaz_pem_der(p_cert,'certificado'),'base64'),E'\n','');
  return '<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">'||info
    ||'<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">'||si||'<SignatureValue>'||signature_text
    ||'</SignatureValue><KeyInfo><X509Data><X509Certificate>'||cert_text
    ||'</X509Certificate></X509Data></KeyInfo></Signature></evento>';
end;
$$;

create function private.sefaz_endpoint(p_id text)
returns text language plpgsql immutable security definer set search_path = ''
as $$
begin
  case p_id
    when 'dfe_producao' then return 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';
    when 'evento_homologacao' then return 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx';
    when 'adn_producao' then return 'https://adn.nfse.gov.br/contribuintes/DFe/';
    else raise exception 'Endereco nao permitido.';
  end case;
end;
$$;

create function private.sefaz_validate(p_empresa text, p_id text, p_modo text, p_numero text)
returns void language plpgsql immutable security definer set search_path = ''
as $$
begin
  if p_empresa is null or p_empresa not in ('rgf','sf') then raise exception 'Empresa invalida.'; end if;
  perform private.sefaz_endpoint(p_id);
  if p_id = 'dfe_producao' then
    if p_modo is null or p_modo not in ('distNSU','consNSU') or p_numero is null
        or p_numero !~ '^[0-9]{15}$' then raise exception 'Modo ou NSU invalido.'; end if;
  elsif p_id = 'adn_producao' then
    if p_modo is not null or p_numero is null or p_numero !~ '^[0-9]{1,15}$' then
      raise exception 'NSU ADN invalido.';
    end if;
  elsif p_modo is not null or p_numero is not null then raise exception 'Entrada de evento invalida.';
  end if;
end;
$$;

create function private.sefaz_dfe_xml(p_cnpj text, p_modo text, p_numero text)
returns text language plpgsql immutable security definer set search_path = ''
as $$
declare query_xml text;
begin
  perform private.sefaz_validate('rgf','dfe_producao',p_modo,p_numero);
  if not private.sefaz_cnpj_valido(p_cnpj) then raise exception 'CNPJ invalido.'; end if;
  query_xml := case p_modo when 'distNSU' then '<distNSU><ultNSU>'||p_numero||'</ultNSU></distNSU>'
    else '<consNSU><NSU>'||p_numero||'</NSU></consNSU>' end;
  return '<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">'
    ||'<soap12:Body><nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>'
    ||'<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>43</cUFAutor>'
    ||'<CNPJ>'||p_cnpj||'</CNPJ>'||query_xml||'</distDFeInt></nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>';
end;
$$;

create function private.sefaz_credentials(p_empresa text)
returns text[] language plpgsql stable security definer set search_path = ''
as $$
declare cert text; key_text text;
begin
  if p_empresa is null or p_empresa not in ('rgf','sf') then raise exception 'Empresa invalida.'; end if;
  select decrypted_secret into cert from vault.decrypted_secrets where name = 'sefaz_'||p_empresa||'_certificado';
  select decrypted_secret into key_text from vault.decrypted_secrets where name = 'sefaz_'||p_empresa||'_chave';
  if nullif(btrim(cert),'') is null or nullif(btrim(key_text),'') is null then
    raise exception using errcode = 'P0404', message = 'Certificado nao guardado.';
  end if;
  return array[cert,key_text];
end;
$$;

create function private.sefaz_http_options(p_cert text, p_key text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare cert_pem text; key_pem text;
begin
  perform sefaz_http.http_reset_curlopt();
  -- Extrair somente os blocos PEM; Bag Attributes/CRLF nao vao para libcurl.
  cert_pem := '-----BEGIN CERTIFICATE-----'||E'\n'||encode(private.sefaz_pem_der(p_cert,'certificado'),'base64')
    ||E'\n-----END CERTIFICATE-----\n';
  key_pem := case when position('-----BEGIN RSA PRIVATE KEY-----' in p_key)>0 then 'RSA PRIVATE KEY' else 'PRIVATE KEY' end;
  key_pem := '-----BEGIN '||key_pem||'-----'||E'\n'||encode(private.sefaz_pem_der(p_key,'chave'),'base64')
    ||E'\n-----END '||key_pem||E'-----\n';
  if not sefaz_http.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','1500')
      or not sefaz_http.http_set_curlopt('CURLOPT_TIMEOUT_MS','4500')
      or not sefaz_http.http_set_curlopt('CURLOPT_SSL_VERIFYPEER','1')
      or not sefaz_http.http_set_curlopt('CURLOPT_SSL_VERIFYHOST','2')
      or not sefaz_http.http_set_curlopt('CURLOPT_SSLCERT_BLOB',cert_pem)
      or not sefaz_http.http_set_curlopt('CURLOPT_SSLKEY_BLOB',key_pem) then
    raise exception 'Opcoes TLS indisponiveis.';
  end if;
exception when others then
  perform sefaz_http.http_reset_curlopt();
  raise exception 'Nao foi possivel configurar TLS.';
end;
$$;

create function private.sefaz_http_call(request sefaz_http.http_request)
returns sefaz_http.http_response language plpgsql volatile security definer set search_path = ''
as $$
declare r sefaz_http.http_response;
begin
  select * into r from sefaz_http.http(request);
  return r;
end;
$$;

create function private.sefaz_transport(p_empresa text, p_id text, p_modo text, p_numero text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare credentials text[]; meta jsonb; k numeric[]; endpoint text; body text; action_name text;
  response sefaz_http.http_response; started timestamptz := clock_timestamp(); fictitious text;
  status_text text; etapa text := 'entrada_invalida';
begin
  perform sefaz_http.http_reset_curlopt();
  perform private.sefaz_validate(p_empresa,p_id,p_modo,p_numero);
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
    -- Nunca SQLERRM: libcurl/OpenSSL podem incluir PEM ou informacao fiscal.
    return jsonb_build_object('status',status_text,'motivo',case when sqlstate = 'P0404'
      then 'certificado nao guardado' when sqlstate = 'P0422' then 'chave_cifrada' else etapa end,
      'ms_banco',floor(extract(epoch from (clock_timestamp()-started))*1000));
end;
$$;

create function public.sefaz_prova_dfe(p_empresa text, p_modo text, p_numero text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select private.sefaz_transport(p_empresa,'dfe_producao',p_modo,p_numero); $$;

create function public.sefaz_prova_evento(p_empresa text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select private.sefaz_transport(p_empresa,'evento_homologacao',null,null); $$;

create function public.sefaz_prova_adn(p_empresa text, p_nsu text)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select private.sefaz_transport(p_empresa,'adn_producao',null,p_nsu); $$;

-- Fixar dono, configuracao e privilegios em TODAS as funcoes desta frente.
do $block$
declare f record; papel text;
begin
  for f in select p.oid::regprocedure as assinatura, n.nspname
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname like 'sefaz\_%' escape '\')
       or (n.nspname='public' and p.proname like 'sefaz\_prova\_%' escape '\')
  loop
    execute format('alter function %s owner to postgres', f.assinatura);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.assinatura);
    if f.nspname='public' then execute format('grant execute on function %s to service_role', f.assinatura); end if;
  end loop;
  foreach papel in array array['anon','authenticated','service_role'] loop
    if pg_catalog.has_schema_privilege(papel,'sefaz_http','usage') then
      raise exception 'Acesso indevido ao schema sefaz_http para %.', papel;
    end if;
  end loop;
end;
$block$;

commit;
