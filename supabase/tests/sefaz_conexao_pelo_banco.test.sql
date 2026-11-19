-- Vetor independente Node/OpenSSL, par ficticio fornecido em 19/11/2026.
-- Nenhuma chamada de rede: substituicoes transacionais abaixo sao desfeitas.
begin;
set local search_path = public, extensions, pg_temp;
select no_plan();
create temporary table sefaz_fixture(cert text, key8 text, key1 text, chave text, at_time timestamptz,
  info text, si text, signature text, digest text, evento text);
insert into sefaz_fixture values (
  'Bag Attributes' || E'\r\nsubject=teste\r\n-----BEGIN CERTIFICATE-----\r\n' || 'MIIDyTCCArGgAwIBAgIUMqPamCPppjtu/mcgUYxeDlUBaIYwDQYJKoZIhvcNAQELBQAwdDELMAkGA1UEBhMCQlIxEzARBgNVBAoMCklDUC1CcmFzaWwxGDAWBgNVBAsMD1RFU1RFIFNFTSBWQUxPUjE2MDQGA1UEAwwtRU1QUkVTQSBGSUNUSUNJQSBERSBURVNURSBMVERBOjExMjIyMzMzMDAwMTgxMB4XDTI2MTExOTE4NDA0NVoXDTM2MTExNjE4NDA0NVowdDELMAkGA1UEBhMCQlIxEzARBgNVBAoMCklDUC1CcmFzaWwxGDAWBgNVBAsMD1RFU1RFIFNFTSBWQUxPUjE2MDQGA1UEAwwtRU1QUkVTQSBGSUNUSUNJQSBERSBURVNURSBMVERBOjExMjIyMzMzMDAwMTgxMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt3DASpFFMXvTKIRcwcLOfacI0YTuNVBtDMgupBFyTBI9qRMNPFdwgUlFRA3HjZP+sy1+IeFdkyEa6RvRMrAaJudIyDhiU3qlm1LAHJ4v5GGTia/86WNd31xfZ2FcNc7EmkKJ2oIPD1NCrY5R3NA8JsrwxvfBoYm1jFBLZxQB/kt2uF5+SNJI3hvEmgxp7x2FGaVDyNBDq8PBEyYCzspiIv2pO6BGqu6/V0faddZ8YlFzZZ7RSOZPbai2gZJSQYomF8z42yqjEWCEpURLZro4E816kC+cXhc4qKkN4rTiBkWQxRix5yyZMLAU7QgSJVga9E3fkxdvO98xd5Q9Jgd67wIDAQABo1MwUTAdBgNVHQ4EFgQU9mg538r4Dv7wySb/0UjhP91fao8wHwYDVR0jBBgwFoAU9mg538r4Dv7wySb/0UjhP91fao8wDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEATC4Et3zwUzdMNpvHGnWvGIai0teueE+6WhOz5y2F1Hq3Jy+zX/HBxVggigAJTT0EHzaBXYtUA0tec+G5PJi3HyLolgcQMOK1oU5ri1LcbAqXw7UEsClFGQ2G5hLBHMpxXAXz9LsqZ0HyISoAy0zNhXphh4QyIjhUtSsfx+su33B8WW5gmU+u+F4rQr7l3l0ZctXuORVFsWYkCtCNSjcYH9F0LVf3XID6ekdBkatVC/tdyi/kS6SAQeDo//UnC6CxDymgdCABY/BV8c8257iD4dzhYjdgp/L9RPWTkoggrRiA97Mucsk9+f/tq2bfL+s3lRjiPg0wj5jXCNOSSerIqA==' || E'\r\n-----END CERTIFICATE-----\r\n',
  'Bag Attributes' || E'\r\n-----BEGIN PRIVATE KEY-----\r\n' || 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC3cMBKkUUxe9MohFzBws59pwjRhO41UG0MyC6kEXJMEj2pEw08V3CBSUVEDceNk/6zLX4h4V2TIRrpG9EysBom50jIOGJTeqWbUsAcni/kYZOJr/zpY13fXF9nYVw1zsSaQonagg8PU0KtjlHc0DwmyvDG98GhibWMUEtnFAH+S3a4Xn5I0kjeG8SaDGnvHYUZpUPI0EOrw8ETJgLOymIi/ak7oEaq7r9XR9p11nxiUXNlntFI5k9tqLaBklJBiiYXzPjbKqMRYISlREtmujgTzXqQL5xeFzioqQ3itOIGRZDFGLHnLJkwsBTtCBIlWBr0Td+TF2873zF3lD0mB3rvAgMBAAECggEAVVy5jrmVKlbFx0f45g2iC2TMPLuQIe0gId+RnLWlq3KdkO0Vrqu95dvTyLxkzSQ+VODpnhiCc/Hm1O0l52F9efcMrmdWkiQzpljWnzqZbLxfbKYhmfWsfEE/ABuVTlC+uk4WWkFFgssq7xqYS5n3M9IiQ2SNjX9IpVfEDt6Hou5vSpDJ2Q/DiscFEkSbbdNq28fxGbYDIvIlzJJ/UigdyHxKXbT9ELCvIWXLA3LcPuM0O27/RmW/a/0goEIusCRs9sttqvE6UM2UjAQSUH5Av5rr52MWsvOZGN0gKSggfQCps8tDHJ1f2XeQhiaJlFS+zi6UeBKJkPLEw3GDhe7IKQKBgQDaXvCvlwOQz+Jzcry7DqZs7CPDi2tvSyW8Xg4obkV6piqSBPKTM5t6Ly6Rzi+xXA8G6cfislQbbiAfZs1IeMccDK7Rznty0JEQpiLseSC9QPhk7pU/UBavSgFm+DC3EhaI5yAVQ483bJUWugDZD7WHAYXAbCG+gPoJo/malbiMUwKBgQDXDOodWaED+AIIm53WF1kldtcBhdosopXepEkNgEM6XhewnEeeyQurJXSI0ZLVhPeYpAEVAWNSmPWZ+OAPUDX5AE+iA5pEjwMiORiSIwY3lAmg2yMqBo3LgRpkn8nAODn0QztDXfrwxanOAp4yOBc/q6djEJJ5H1JEReGb3IAjdQKBgF3kopKtWRAkApdnRzUa+H4vDrWeteQVqLUUr/u8Zk11Myqzy+V1NC3WKazxvdoB3kg3rwWPbdCZimBWIIA/xkUOQwDdSoE0optJBA0vi980F1m2qB+f/REDvhSbNL8SnPPihQ3/jY3kNzqdYY3zTjctdWgmVmAGLvyEL+fC5qYXAoGAGV8Yr+XHLWSxOLrDYGLYzaa7rx5Pozx7Wg0f4Uvkopo/SULm4EDv830zxoCTRkWtwIB48DV9tlz9fPDz3lqkQ4BZ5M9v/+6ve/Yog/VF4oDAsg2olGi5ieztZDnF37vCeqMD9uq7lHR9mCSO7XXYqFZkJTfrUAb1+cAU4gKdy5ECgYEAwk1IH8ipr07moXNuGuD0OTtwf1eWxe9CMHbQpR4CMkSrFgzhUgTBwgUus9V5/MJwjnpXHcf545i0zDQbSKnP0PsKJsigWM5FFc98bjoGyqQYkclTD9lbqAEtOYX+K0aA8tM9kSDANuYCfyOzFcDbOhkWhoRzgd74Hu20e+g9/OA=' || E'\r\n-----END PRIVATE KEY-----\r\n',
  'subject=teste' || E'\n-----BEGIN RSA PRIVATE KEY-----\n' || 'MIIEowIBAAKCAQEAt3DASpFFMXvTKIRcwcLOfacI0YTuNVBtDMgupBFyTBI9qRMNPFdwgUlFRA3HjZP+sy1+IeFdkyEa6RvRMrAaJudIyDhiU3qlm1LAHJ4v5GGTia/86WNd31xfZ2FcNc7EmkKJ2oIPD1NCrY5R3NA8JsrwxvfBoYm1jFBLZxQB/kt2uF5+SNJI3hvEmgxp7x2FGaVDyNBDq8PBEyYCzspiIv2pO6BGqu6/V0faddZ8YlFzZZ7RSOZPbai2gZJSQYomF8z42yqjEWCEpURLZro4E816kC+cXhc4qKkN4rTiBkWQxRix5yyZMLAU7QgSJVga9E3fkxdvO98xd5Q9Jgd67wIDAQABAoIBAFVcuY65lSpWxcdH+OYNogtkzDy7kCHtICHfkZy1patynZDtFa6rveXb08i8ZM0kPlTg6Z4YgnPx5tTtJedhfXn3DK5nVpIkM6ZY1p86mWy8X2ymIZn1rHxBPwAblU5QvrpOFlpBRYLLKu8amEuZ9zPSIkNkjY1/SKVXxA7eh6Lub0qQydkPw4rHBRJEm23TatvH8Rm2AyLyJcySf1IoHch8Sl20/RCwryFlywNy3D7jNDtu/0Zlv2v9IKBCLrAkbPbLbarxOlDNlIwEElB+QL+a6+djFrLzmRjdICkoIH0AqbPLQxydX9l3kIYmiZRUvs4ulHgSiZDyxMNxg4XuyCkCgYEA2l7wr5cDkM/ic3K8uw6mbOwjw4trb0slvF4OKG5FeqYqkgTykzObei8ukc4vsVwPBunH4rJUG24gH2bNSHjHHAyu0c57ctCREKYi7HkgvUD4ZO6VP1AWr0oBZvgwtxIWiOcgFUOPN2yVFroA2Q+1hwGFwGwhvoD6CaP5mpW4jFMCgYEA1wzqHVmhA/gCCJud1hdZJXbXAYXaLKKV3qRJDYBDOl4XsJxHnskLqyV0iNGS1YT3mKQBFQFjUpj1mfjgD1A1+QBPogOaRI8DIjkYkiMGN5QJoNsjKgaNy4EaZJ/JwDg59EM7Q1368MWpzgKeMjgXP6unYxCSeR9SREXhm9yAI3UCgYBd5KKSrVkQJAKXZ0c1Gvh+Lw61nrXkFai1FK/7vGZNdTMqs8vldTQt1ims8b3aAd5IN68Fj23QmYpgViCAP8ZFDkMA3UqBNKKbSQQNL4vfNBdZtqgfn/0RA74UmzS/Epzz4oUN/42N5Dc6nWGN8043LXVoJlZgBi78hC/nwuamFwKBgBlfGK/lxy1ksTi6w2Bi2M2mu68eT6M8e1oNH+FL5KKaP0lC5uBA7/N9M8aAk0ZFrcCAePA1fbZc/Xzw895apEOAWeTPb//ur3v2KIP1ReKAwLINqJRouYns7WQ5xd+7wnqjA/bqu5R0fZgkju112KhWZCU361AG9fnAFOICncuRAoGBAMJNSB/Iqa9O5qFzbhrg9Dk7cH9XlsXvQjB20KUeAjJEqxYM4VIEwcIFLrPVefzCcI56Vx3H+eOYtMw0G0ipz9D7CibIoFjORRXPfG46BsqkGJHJUw/ZW6gBLTmF/itGgPLTPZEgwDbmAn8jsxXA2zoZFoaEc4He+B7ttHvoPfzg' || E'\n-----END RSA PRIVATE KEY-----\n',
  '43261111222333000181550010000000011000000016', '2026-11-19T19:00:00Z',
  '<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" Id="ID2102104326111122233300018155001000000001100000001601"><cOrgao>91</cOrgao><tpAmb>2</tpAmb><CNPJ>11222333000181</CNPJ><chNFe>43261111222333000181550010000000011000000016</chNFe><dhEvento>2026-11-19T16:00:00-03:00</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento>',
  '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI="#ID2102104326111122233300018155001000000001100000001601"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>pxXQ5h27FcxFm3Mw1pWEzX9U0ww=</DigestValue></Reference></SignedInfo>',
  'reb10P9WIt6Y4PIxIqhgSkI2KPrGRsAAspjJsvY6pSV4/bDZuHHu1SAVq2l21R7Yiks5Z2HFX/omCO9XYvF7Vcz7CVR+kjp09rTZJjmhKVHkaglxqQUlG/fPWogVehN9NHsw+z76IzCE/ayervzBs2y7deFbm77SO5PaVYoL2F0WsV+YOK3xvS9WtND9JKVRekIL1INOVhfaPpWanf9Nt8Rk927/scZjXIFwlW26/4KhCD8b5CK+VomL0NWtVFS9qLe8E64lR+2+GvZEfXdqr5vKATIFNgJcX72zZL3EiAYtN4aw7TFb9MKBDUBHoxAKnBK5HrNCU1AHBHlrDiYV2A==',
  'pxXQ5h27FcxFm3Mw1pWEzX9U0ww=',
  '<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento xmlns="http://www.portalfiscal.inf.br/nfe" Id="ID2102104326111122233300018155001000000001100000001601"><cOrgao>91</cOrgao><tpAmb>2</tpAmb><CNPJ>11222333000181</CNPJ><chNFe>43261111222333000181550010000000011000000016</chNFe><dhEvento>2026-11-19T16:00:00-03:00</dhEvento><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Ciencia da Operacao</descEvento></detEvento></infEvento><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI="#ID2102104326111122233300018155001000000001100000001601"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>pxXQ5h27FcxFm3Mw1pWEzX9U0ww=</DigestValue></Reference></SignedInfo><SignatureValue>reb10P9WIt6Y4PIxIqhgSkI2KPrGRsAAspjJsvY6pSV4/bDZuHHu1SAVq2l21R7Yiks5Z2HFX/omCO9XYvF7Vcz7CVR+kjp09rTZJjmhKVHkaglxqQUlG/fPWogVehN9NHsw+z76IzCE/ayervzBs2y7deFbm77SO5PaVYoL2F0WsV+YOK3xvS9WtND9JKVRekIL1INOVhfaPpWanf9Nt8Rk927/scZjXIFwlW26/4KhCD8b5CK+VomL0NWtVFS9qLe8E64lR+2+GvZEfXdqr5vKATIFNgJcX72zZL3EiAYtN4aw7TFb9MKBDUBHoxAKnBK5HrNCU1AHBHlrDiYV2A==</SignatureValue><KeyInfo><X509Data><X509Certificate>MIIDyTCCArGgAwIBAgIUMqPamCPppjtu/mcgUYxeDlUBaIYwDQYJKoZIhvcNAQELBQAwdDELMAkGA1UEBhMCQlIxEzARBgNVBAoMCklDUC1CcmFzaWwxGDAWBgNVBAsMD1RFU1RFIFNFTSBWQUxPUjE2MDQGA1UEAwwtRU1QUkVTQSBGSUNUSUNJQSBERSBURVNURSBMVERBOjExMjIyMzMzMDAwMTgxMB4XDTI2MTExOTE4NDA0NVoXDTM2MTExNjE4NDA0NVowdDELMAkGA1UEBhMCQlIxEzARBgNVBAoMCklDUC1CcmFzaWwxGDAWBgNVBAsMD1RFU1RFIFNFTSBWQUxPUjE2MDQGA1UEAwwtRU1QUkVTQSBGSUNUSUNJQSBERSBURVNURSBMVERBOjExMjIyMzMzMDAwMTgxMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAt3DASpFFMXvTKIRcwcLOfacI0YTuNVBtDMgupBFyTBI9qRMNPFdwgUlFRA3HjZP+sy1+IeFdkyEa6RvRMrAaJudIyDhiU3qlm1LAHJ4v5GGTia/86WNd31xfZ2FcNc7EmkKJ2oIPD1NCrY5R3NA8JsrwxvfBoYm1jFBLZxQB/kt2uF5+SNJI3hvEmgxp7x2FGaVDyNBDq8PBEyYCzspiIv2pO6BGqu6/V0faddZ8YlFzZZ7RSOZPbai2gZJSQYomF8z42yqjEWCEpURLZro4E816kC+cXhc4qKkN4rTiBkWQxRix5yyZMLAU7QgSJVga9E3fkxdvO98xd5Q9Jgd67wIDAQABo1MwUTAdBgNVHQ4EFgQU9mg538r4Dv7wySb/0UjhP91fao8wHwYDVR0jBBgwFoAU9mg538r4Dv7wySb/0UjhP91fao8wDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEATC4Et3zwUzdMNpvHGnWvGIai0teueE+6WhOz5y2F1Hq3Jy+zX/HBxVggigAJTT0EHzaBXYtUA0tec+G5PJi3HyLolgcQMOK1oU5ri1LcbAqXw7UEsClFGQ2G5hLBHMpxXAXz9LsqZ0HyISoAy0zNhXphh4QyIjhUtSsfx+su33B8WW5gmU+u+F4rQr7l3l0ZctXuORVFsWYkCtCNSjcYH9F0LVf3XID6ekdBkatVC/tdyi/kS6SAQeDo//UnC6CxDymgdCABY/BV8c8257iD4dzhYjdgp/L9RPWTkoggrRiA97Mucsk9+f/tq2bfL+s3lRjiPg0wj5jXCNOSSerIqA==</X509Certificate></X509Data></KeyInfo></Signature></evento>'
);

select is((select extnamespace::regnamespace::text from pg_extension where extname='http'), 'sefaz_http', 'http em sefaz_http');
select ok(not has_schema_privilege(r.rolname,'sefaz_http','usage'), r.rolname||' sem acesso ao schema da extensao')
from (values ('anon'),('authenticated'),('service_role')) r(rolname);
select throws_ok($$set local role anon; select sefaz_http.http_reset_curlopt()$$,
  '42501','permission denied for schema sefaz_http','anon nao chama extensao');
select throws_ok($$set local role authenticated; select sefaz_http.http_reset_curlopt()$$,
  '42501','permission denied for schema sefaz_http','authenticated nao chama extensao');
select throws_ok($$set local role service_role; select sefaz_http.http_reset_curlopt()$$,
  '42501','permission denied for schema sefaz_http','service_role nao chama extensao');

select ok(to_regprocedure('private.sefaz_http_call(sefaz_http.http_request)') is not null,'involucro HTTP privado existe');
select ok(not has_function_privilege(r.rolname,p.oid,'execute'), r.rolname||' bloqueado em '||p.oid::regprocedure)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join (values ('anon'),('authenticated'),('service_role')) r(rolname)
where n.nspname='private' and p.proname like 'sefaz\_%' escape '\';
select ok(has_function_privilege(r.rolname,p.oid,'execute') = (r.rolname='service_role'),
  r.rolname||' privilegio efetivo da RPC '||p.oid::regprocedure)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join (values ('anon'),('authenticated'),('service_role')) r(rolname)
where n.nspname='public' and p.proname like 'sefaz\_prova\_%' escape '\';
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'sefaz\_prova\_%' escape '\'),3,'so tres RPCs publicas, nenhuma le PEM ou assina conteudo arbitrario');
select ok(p.prosecdef and p.proowner='postgres'::regrole and 'search_path=""'=any(p.proconfig),
  'dono e search_path de '||p.oid::regprocedure)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and p.proname like 'sefaz\_%' escape '\';
select ok(coalesce('client_min_messages=warning'=any(p.proconfig),false),
  'diagnostico da extensao silenciado em '||f.assinatura)
from (values
  ('private.sefaz_http_options(text,text)'::regprocedure),
  ('private.sefaz_http_call(sefaz_http.http_request)'::regprocedure),
  ('private.sefaz_transport(text,text,text,text)'::regprocedure)
) f(assinatura) join pg_proc p on p.oid=f.assinatura;
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relname like 'sefaz%' and c.relkind in ('r','p')),0,'nenhuma tabela SEFAZ criada');

select throws_ok($$select private.sefaz_validate('jc','dfe_producao','distNSU','000000000000000')$$,'P0001','Empresa invalida.','empresa fora da lista');
select throws_ok($$select private.sefaz_validate(null,'dfe_producao','distNSU','000000000000000')$$,'P0001','Empresa invalida.','empresa nula');
select throws_ok($$select private.sefaz_endpoint('evento_producao')$$,'P0001','Endereco nao permitido.','evento real proibido');
select throws_ok($$select private.sefaz_endpoint('https://exemplo.com')$$,'P0001','Endereco nao permitido.','URL arbitraria proibida');
select throws_ok($$select private.sefaz_endpoint(null)$$,'P0001','Endereco nao permitido.','endereco nulo proibido');
select throws_ok($$select private.sefaz_validate('rgf','dfe_producao','consChNFe','000000000000000')$$,'P0001','Modo ou NSU invalido.','modo proibido');
select throws_ok($$select private.sefaz_validate('rgf','dfe_producao','distNSU','1')$$,'P0001','Modo ou NSU invalido.','NSU curto');
select throws_ok($$select private.sefaz_validate('rgf','dfe_producao','distNSU',repeat('1',16))$$,'P0001','Modo ou NSU invalido.','NSU longo');
select throws_ok($$select private.sefaz_validate('rgf','adn_producao',null,'../')$$,'P0001','NSU ADN invalido.','ADN sem injecao de caminho');
select throws_ok($$select private.sefaz_validate('rgf','evento_homologacao','210220',null)$$,'P0001','Entrada de evento invalida.','outro evento proibido');
select lives_ok($$select private.sefaz_validate('sf','dfe_producao','consNSU','000000000000001')$$,'consulta individual permitida');
select is(private.sefaz_endpoint('evento_homologacao'),'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx','destino hom1 fixo');
select is(private.sefaz_endpoint('dfe_producao'),'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx','destino distribuicao fixo');
select is(private.sefaz_endpoint('adn_producao'),'https://adn.nfse.gov.br/contribuintes/DFe/','ADN fixo');
select ok(private.sefaz_cnpj_valido('11222333000181') and not private.sefaz_cnpj_valido('11222333000182')
  and not private.sefaz_cnpj_valido('00000000000000') and not private.sefaz_cnpj_valido(null),'CNPJ exige dois verificadores');
select throws_ok($$select private.sefaz_der_node(decode('3082ff','hex'),1)$$,'P0001','DER invalido.','DER truncado recusado');
select throws_ok($$select private.sefaz_der_content(decode('30800000','hex'),48)$$,'P0001','DER invalido.','DER indefinido recusado');
select throws_ok($$select private.sefaz_pem_der('-----BEGIN ENCRYPTED PRIVATE KEY-----','chave')$$,'P0422',
  'Chave cifrada: refaca a conversao sem senha.','chave cifrada exige reconversao');
select throws_ok($$select private.sefaz_pem_der('Bag Attributes somente','certificado')$$,'P0001','PEM invalido.','PEM ausente');
select is(private.sefaz_certificate(cert)->>'cnpj','11222333000181','CNPJ extraido do CN DER') from sefaz_fixture;
select is((private.sefaz_certificate(cert)->>'not_after')::timestamptz,'2036-11-16T18:40:45Z'::timestamptz,'validade X509 lida') from sefaz_fixture;
select is(private.sefaz_rsa_key(key8),private.sefaz_rsa_key(key1),'PKCS8 e PKCS1, Bag Attributes e CRLF aceitos') from sefaz_fixture;
select is(private.sefaz_evento_info('11222333000181',chave,at_time),info,'infEvento canonico e horario de Brasilia, vetor Node') from sefaz_fixture;
select is(private.sefaz_signed_info(info,'ID210210'||chave||'01'),si,'SignedInfo canonico, vetor Node') from sefaz_fixture;
select is(replace(encode(extensions.digest(convert_to(info,'UTF8'),'sha1'),'base64'),E'\n',''),digest,'digest SHA1 independente') from sefaz_fixture;
select throws_ok($$select private.sefaz_evento_info('11222333000181',repeat('1',44),now())$$,'P0001','Entrada de evento invalida.','chave fora de RS/modelo 55 recusada');
select throws_ok($$select private.sefaz_evento_info('11222333000181','43261111222333000181550010000000011000000010',now())$$,'P0001','Chave ficticia invalida.','DV da chave conferido');
select set_config('sefaz_test.assinatura_inicio',clock_timestamp()::text,true);
select is(private.sefaz_evento_xml(cert,key8,chave,at_time),evento,'XML e RSA-SHA1 PKCS8 iguais ao Node') from sefaz_fixture;
select diag('Assinatura PKCS8 em ms: ' || floor(extract(epoch from
  (clock_timestamp()-current_setting('sefaz_test.assinatura_inicio')::timestamptz))*1000)::text);
select is(private.sefaz_evento_xml(cert,key1,chave,at_time),evento,'XML e RSA-SHA1 PKCS1 iguais ao Node') from sefaz_fixture;
select is(substring(private.sefaz_evento_xml(cert,key8,chave,at_time) from '<SignatureValue>([^<]+)</SignatureValue>'),signature,'assinatura isolada confere') from sefaz_fixture;
select ok(private.sefaz_dfe_xml('11222333000181','distNSU','000000000000000') like '%<distNSU><ultNSU>000000000000000</ultNSU></distNSU>%','distribuicao monta somente distNSU');
select ok(private.sefaz_dfe_xml('11222333000181','consNSU','000000000000001') like '%<consNSU><NSU>000000000000001</NSU></consNSU>%','consulta monta somente consNSU');

-- Provar a limpeza diretamente e pelo transporte; os stubs sao transacionais.
select lives_ok($$select private.sefaz_http_options(cert,key8) from pg_temp.sefaz_fixture$$,'configura TLS sem abortar os testes seguintes');
select is((select count(*)::integer from sefaz_http.http_list_curlopt() where curlopt in ('CURLOPT_SSLCERT_BLOB','CURLOPT_SSLKEY_BLOB') and value is not null),2,'ambos os BLOBs configurados');
select lives_ok($$select sefaz_http.http_reset_curlopt()$$,'reset executa sem abortar os testes seguintes');
select is((select count(*)::integer from sefaz_http.http_list_curlopt() where curlopt in ('CURLOPT_SSLCERT_BLOB','CURLOPT_SSLKEY_BLOB') and value is not null),0,'reset remove os BLOBs');
select throws_ok($$select private.sefaz_http_options(cert,'invalida') from pg_temp.sefaz_fixture$$,'P0001','Nao foi possivel configurar TLS.','erro de configuracao nao revela chave');
select is((select count(*)::integer from sefaz_http.http_list_curlopt() where curlopt in ('CURLOPT_SSLCERT_BLOB','CURLOPT_SSLKEY_BLOB') and value is not null),0,'erro de configuracao limpa BLOBs');

create or replace function private.sefaz_credentials(p_empresa text)
returns text[] language sql stable security definer set search_path = ''
as $$select array[cert,key8] from pg_temp.sefaz_fixture$$;
create or replace function private.sefaz_http_call(request sefaz_http.http_request)
returns sefaz_http.http_response language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from sefaz_http.http_list_curlopt() where curlopt in ('CURLOPT_SSLCERT_BLOB','CURLOPT_SSLKEY_BLOB') and value is not null) <> 2 then
    raise exception 'Stub nao recebeu os BLOBs.';
  end if;
  perform set_config('sefaz_test.uri',request.uri,true);
  perform set_config('sefaz_test.content',coalesce(request.content,''),true);
  if current_setting('sefaz_test.fail',true) = '1' then raise exception 'ERRO SENSIVEL QUE NAO PODE SAIR'; end if;
  if current_setting('sefaz_test.cancel',true) = '1' then raise exception using errcode='57014',message='cancelamento simulado'; end if;
  if current_setting('sefaz_test.redirect',true) = 'location' then
    return (200,'text/xml',array[sefaz_http.http_header('Location','https://exemplo.com')],'CORPO QUE NAO PODE SAIR')::sefaz_http.http_response;
  end if;
  if current_setting('sefaz_test.redirect',true) = 'status' then
    return (302,'text/xml',array[]::sefaz_http.http_header[],'CORPO QUE NAO PODE SAIR')::sefaz_http.http_response;
  end if;
  return (200,'text/xml',array[]::sefaz_http.http_header[],'<resposta/>')::sefaz_http.http_response;
end;
$$;
select is(public.sefaz_prova_dfe('rgf','distNSU','000000000000000')->>'status','ok','RPC usa transporte com stub sem rede');
select is(current_setting('sefaz_test.uri',true),'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx','URI realmente enviada e fixa');
select is((select count(*)::integer from sefaz_http.http_list_curlopt() where curlopt in ('CURLOPT_SSLCERT_BLOB','CURLOPT_SSLKEY_BLOB') and value is not null),0,'sucesso do transporte limpa BLOBs');
select is(public.sefaz_prova_adn('sf','0')->>'status','ok','ADN usa transporte');
select is(current_setting('sefaz_test.uri',true),'https://adn.nfse.gov.br/contribuintes/DFe/0','ADN sem cnpjConsulta');
select is(public.sefaz_prova_evento('rgf')->>'status','ok','evento assinado chega ao transporte');
select is(current_setting('sefaz_test.uri',true),'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx','evento somente homologacao');
select ok(current_setting('sefaz_test.content',true) like '%<tpAmb>2</tpAmb>%' and current_setting('sefaz_test.content',true) like '%<tpEvento>210210</tpEvento>%','evento fixo 210210 tpAmb 2');
select set_config('sefaz_test.redirect','location',true);
select is(public.sefaz_prova_dfe('rgf','distNSU','000000000000000')->>'status','falhou','Location em 200 recusa resposta');
select is(public.sefaz_prova_dfe('rgf','distNSU','000000000000000')->>'motivo','redirecionado','Location acumulado acusa redirecionamento');
select ok(not (public.sefaz_prova_dfe('rgf','distNSU','000000000000000') ? 'body'),'Location nunca devolve body');
select is((select count(*)::integer from sefaz_http.http_list_curlopt() where curlopt in ('CURLOPT_SSLCERT_BLOB','CURLOPT_SSLKEY_BLOB') and value is not null),0,'Location limpa BLOBs');
select set_config('sefaz_test.redirect','status',true);
select is(public.sefaz_prova_adn('sf','0')->>'motivo','redirecionado','302 sem Location tambem recusa resposta');
select ok(not (public.sefaz_prova_adn('sf','0') ? 'body'),'302 nunca devolve body');
select is((select count(*)::integer from sefaz_http.http_list_curlopt() where curlopt in ('CURLOPT_SSLCERT_BLOB','CURLOPT_SSLKEY_BLOB') and value is not null),0,'302 limpa BLOBs');
select set_config('sefaz_test.redirect','0',true);
select set_config('sefaz_test.fail','1',true);
select is(public.sefaz_prova_dfe('rgf','distNSU','000000000000000')->>'motivo','falha_transporte','erro bruto do transporte nunca retorna');
select is((select count(*)::integer from sefaz_http.http_list_curlopt() where curlopt in ('CURLOPT_SSLCERT_BLOB','CURLOPT_SSLKEY_BLOB') and value is not null),0,'erro de transporte limpa BLOBs');
select set_config('sefaz_test.fail','0',true);
select set_config('sefaz_test.cancel','1',true);
select is(public.sefaz_prova_adn('rgf','0')->>'motivo','tempo_banco','query_canceled tambem e capturado');
select is((select count(*)::integer from sefaz_http.http_list_curlopt() where curlopt in ('CURLOPT_SSLCERT_BLOB','CURLOPT_SSLKEY_BLOB') and value is not null),0,'cancelamento limpa BLOBs');
select set_config('sefaz_test.cancel','0',true);
select is(public.sefaz_prova_dfe('invalida','distNSU','000000000000000')->>'status','falhou','RPC rejeita entrada antes de transporte');

-- Substituir leitura do cofre por ausencia controlada, sem alterar Vault.
create or replace function private.sefaz_credentials(p_empresa text)
returns text[] language plpgsql stable security definer set search_path = '' as $$
begin raise exception using errcode='P0404',message='Certificado nao guardado.'; end;
$$;
set local role service_role;
select is(public.sefaz_prova_dfe('sf','consNSU','000000000000001')->>'status','sem_certificado','service_role executa RPC publica');
reset role;
select is((select count(*)::integer from sefaz_http.http_list_curlopt() where curlopt in ('CURLOPT_SSLCERT_BLOB','CURLOPT_SSLKEY_BLOB') and value is not null),0,'ausencia de cofre nao deixa BLOBs');
select * from finish();
rollback;
